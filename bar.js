/**
 * Copyright 2011 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @author opensource@google.com
 * @license Apache License, Version 2.0.
 */

'use strict';

// Constants.
var RELOCATE_COOLDOWN_PERIOD_MS = 400;

// Drag limits: the Query box's share of the bar width, and the shortest the
// boxes may be dragged.
var MIN_QUERY_W_PCT = 20;
var MAX_QUERY_W_PCT = 80;
var MIN_TEXT_H_PX = 40;

// Global variables.
var queryEl = document.getElementById('query');
var resultsEl = document.getElementById('results');
var nodeCountEl = document.getElementById('node-count');
var rowEl = document.getElementById('row');
var queryBoxEl = document.getElementById('query-box');
var vsplitEl = document.getElementById('vsplit');
var hsplitEl = document.getElementById('hsplit');

var nodeCountText = document.createTextNode('0');
nodeCountEl.appendChild(nodeCountText);

// Used by handleMouseMove() to enforce a cooldown period on relocate.
var mostRecentRelocateTimeInMs = 0;

// True while a divider is being dragged. Relocating then would move the bar out
// from under the pointer mid-drag.
var dragInProgress = false;

var evaluateQuery = function() {
  var request = {
    'type': 'evaluate',
    'query': queryEl.value
  };
  chrome.runtime.sendMessage(request);
};

var handleRequest = function(request, sender, callback) {
  // Note: Setting textarea's value and text node's nodeValue is XSS-safe.
  // Loose != null so an absent (undefined) field is skipped, not rendered.
  if (request['type'] === 'update') {
    if (request['query'] != null) {
      queryEl.value = request['query'];
    }
    if (request['results'] != null) {
      resultsEl.value = request['results'][0];
      nodeCountText.nodeValue = request['results'][1];
    }
  } else if (request['type'] === 'barPosition') {
    document.body.classList.toggle('at-bottom', request['atBottom']);
  }
};

var handleMouseMove = function(e) {
  if (e.shiftKey && !dragInProgress) {
    // Only relocate if we aren't in the cooldown period. Note, the cooldown
    // duration should take CSS transition time into consideration.
    var timeInMs = new Date().getTime();
    if (timeInMs - mostRecentRelocateTimeInMs < RELOCATE_COOLDOWN_PERIOD_MS) {
      return;
    }
    mostRecentRelocateTimeInMs = timeInMs;

    // Tell content script to move iframe to a different part of the screen.
    chrome.runtime.sendMessage({'type': 'relocateBar'});
  }
};

queryEl.addEventListener('keyup', evaluateQuery);
queryEl.addEventListener('mouseup', evaluateQuery);

// Both dividers are dragged the same way: watch the document for the pointer
// until it is released. onStart runs once as the drag begins and returns the
// state onMove/onEnd receive; onEnd runs on release, including a release that
// is only noticed later.
var addDragHandler = function(handleEl, onStart, onMove, onEnd) {
  handleEl.addEventListener('pointerdown', function(e) {
    var pointerId = e.pointerId;
    e.preventDefault();

    try {
      handleEl.setPointerCapture(pointerId);
    } catch (err) {
      // Best effort only: the document listeners below still cover the drag
      // while the pointer stays within the element.
    }

    var state = onStart(e);
    dragInProgress = true;

    var handleMove = function(ev) {
      if (ev.pointerId !== pointerId) {
        return;
      }
      // A release outside the window never reaches us, so notice it here
      // rather than leaving the listeners attached.
      if (!ev.buttons) {
        handleUp();
        return;
      }
      onMove(ev, state);
    };

    var handleUp = function() {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
      dragInProgress = false;
      onEnd(state);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleUp);
  });
};

// Trade width between the two boxes by writing --query-w on <body>: #query-box
// uses it as its flex-basis and #results-box takes the rest, so the two always
// add up to the full width.
addDragHandler(vsplitEl, function(e) {
  return {
    startX: e.clientX,
    rowW: rowEl.clientWidth,
    startPct: queryBoxEl.offsetWidth / rowEl.clientWidth * 100
  };
}, function(ev, state) {
  var pct = state.startPct + (ev.clientX - state.startX) / state.rowW * 100;
  pct = Math.max(MIN_QUERY_W_PCT, Math.min(MAX_QUERY_W_PCT, pct));
  document.body.style.setProperty('--query-w', pct + '%');
}, function() {});

// Change how tall both boxes are; they share --text-h, so the bar resizes as a
// whole. The bar cannot resize its own iframe, so the content script does it:
// 'resizeStart' stretches the iframe over the host viewport for the duration of
// the drag, 'resizeEnd' hands it the height to settle on. That stretch is what
// makes the drag work at all - the pointer has to travel below the bar's box to
// make it taller, and pointer events stop dead at the iframe's edge.
addDragHandler(hsplitEl, function(e) {
  var startTextH = queryEl.offsetHeight;
  var state = {
    startY: e.clientY,
    startTextH: startTextH,
    // Everything in the bar that isn't a textarea - labels, padding, the
    // bottom divider. Constant during the drag, so it caps how tall the boxes
    // may get: any taller and the bar would push its own divider off screen.
    chromeH: document.body.offsetHeight - startTextH,
    // The bar's own height until 'resizeStart' is applied (see onMove).
    preStretchH: window.innerHeight,
    // Snapshot: the drag keeps its direction even if the bar relocates.
    atBottom: document.body.classList.contains('at-bottom'),
    maxTextH: Infinity
  };
  chrome.runtime.sendMessage({'type': 'resizeStart'}).catch(function() {});
  return state;
}, function(ev, state) {
  if (state.maxTextH === Infinity && window.innerHeight > state.preStretchH) {
    var stretchDelta = window.innerHeight - state.preStretchH;
    state.maxTextH = window.innerHeight - state.chromeH;
    if (state.atBottom) {
      // Stretching a bottom-pinned bar lifts its iframe to the top of the host
      // viewport, so clientY values jump by that much; shift the baseline
      // captured before the stretch into the new coordinate space.
      state.startY += stretchDelta;
    }
  }
  var dy = ev.clientY - state.startY;
  if (state.atBottom) {
    // Pinned to the bottom, the bar grows away from that edge, i.e. upwards.
    dy = -dy;
  }
  var textH = Math.min(state.startTextH + dy, state.maxTextH);
  document.body.style.setProperty(
      '--text-h', Math.max(MIN_TEXT_H_PX, textH) + 'px');
}, function() {
  chrome.runtime.sendMessage({
    'type': 'resizeEnd',
    'height': document.body.offsetHeight
  }).catch(function() {});
});

// Add mousemove listener so we can detect Shift + mousemove inside iframe.
document.addEventListener('mousemove', handleMouseMove);
// Ctrl-Shift-X toggling is a browser-level extension command (see manifest
// "commands"), so bar.js does not need its own keydown handler.

chrome.runtime.onMessage.addListener(handleRequest);

var request = {
  'type': 'height',
  'height': document.documentElement.offsetHeight
};
chrome.runtime.sendMessage(request);
