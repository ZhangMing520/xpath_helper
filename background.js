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

// Relay messages between content.js and bar.js. The bar runs in an extension
// iframe, so neither script can reach the other directly; forwarding through
// the service worker delivers each message to every frame of the host tab
// that has a listener (the content script and the bar iframe).
chrome.runtime.onMessage.addListener((request, sender) => {
  if (!sender.tab) {
    return;
  }
  // No receiver is expected to respond; swallow "receiving end does not
  // exist" errors while the tab is navigating away.
  chrome.tabs.sendMessage(sender.tab.id, request).catch(() => {});
});
