/**
 * Embeddable configurator loader.
 *
 * Drop this on any page:
 *
 *   <div id="building-designer"></div>
 *   <script src="https://YOUR-HOST/embed.js"
 *           data-target="#building-designer"
 *           data-model="garage"
 *           data-height="760"
 *           async></script>
 *
 * The widget runs in an iframe, so the host page's CSS and JavaScript can
 * never collide with it. Lead submissions are forwarded to the host page as a
 * `building-designer:lead` CustomEvent on `window`, which is where analytics,
 * a CRM pixel, or a redirect should hook in.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var base = script.src.replace(/\/embed\.js(\?.*)?$/, '');
  var data = script.dataset || {};

  var target = data.target ? document.querySelector(data.target) : null;
  if (!target) {
    // No explicit target: render where the script tag sits.
    target = document.createElement('div');
    script.parentNode.insertBefore(target, script);
  }

  var params = new URLSearchParams();
  params.set('embed', '1');
  if (data.mode === 'internal') params.set('mode', 'internal');
  if (data.model) params.set('model', data.model);

  var src = base + '/index.html?' + params.toString() + (data.design ? '#d=' + data.design : '');

  var iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = data.title || 'Building designer';
  iframe.loading = 'lazy';
  iframe.allow = 'clipboard-write; fullscreen';
  iframe.setAttribute('allowfullscreen', '');
  iframe.style.cssText = [
    'width:100%',
    'border:0',
    'display:block',
    'border-radius:' + (data.radius || '12px'),
    'background:#eef0f3',
    'box-shadow:0 1px 2px rgba(16,20,26,.06),0 10px 30px rgba(16,20,26,.08)',
  ].join(';');

  function sizeIt() {
    var fixed = parseInt(data.height || '', 10);
    if (fixed > 0) {
      iframe.style.height = fixed + 'px';
      return;
    }
    // Responsive default: tall enough for the panel, never taller than the viewport.
    var h = Math.max(620, Math.min(900, Math.round(window.innerHeight * 0.88)));
    if (window.innerWidth < 760) h = Math.max(760, Math.round(window.innerHeight * 0.95));
    iframe.style.height = h + 'px';
  }

  sizeIt();
  window.addEventListener('resize', sizeIt);
  target.appendChild(iframe);

  window.addEventListener('message', function (event) {
    if (event.source !== iframe.contentWindow) return;
    var msg = event.data;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    if (msg.type.indexOf('bc:') !== 0) return;

    if (msg.type === 'bc:resize' && !data.height && msg.height > 0) {
      iframe.style.height = Math.round(msg.height) + 'px';
      return;
    }

    window.dispatchEvent(
      new CustomEvent('building-designer:' + msg.type.slice(3), { detail: msg })
    );
  });
})();
