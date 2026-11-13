<?php
/**
 * Template Name: Ask Avi Chatbot
 *
 * WordPress (Kadence Theme) Page Template for embedding Ask Avi
 * inside aviperera.com without header/footer clipping or LiteSpeed lazy-load breaks.
 *
 * Installation on WordPress (avi-wp-theme):
 *   1. Copy this file to your theme directory as `page-ask-avi.php`
 *      (or save under a slug-matched template `page-{slug}.php`).
 *   2. In WP Admin -> Pages -> Add New:
 *        - Title: Ask Avi
 *        - Permalink / Slug: ask-avi
 *        - Page Attributes -> Template: Ask Avi Chatbot
 *   3. Clear LiteSpeed Cache after publishing.
 *
 * Theme Sync:
 *   Reads aviperera.com's `html[data-theme]` ("dark" | "light") at load time
 *   and observes theme switches to keep Ask Avi synchronized via postMessage.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();

$ask_avi_base_url = apply_filters(
	'ask_avi_app_url',
	'https://a-vip.github.io/ask-avi/'
);

$ask_avi_initial_params = array(
	'embed' => '1',
);

if ( isset( $_GET['q'] ) && is_string( $_GET['q'] ) ) {
	$ask_avi_initial_params['q'] = sanitize_text_field( wp_unslash( $_GET['q'] ) );
}
if ( isset( $_GET['theme'] ) && in_array( $_GET['theme'], array( 'dark', 'light' ), true ) ) {
	$ask_avi_initial_params['theme'] = sanitize_text_field( wp_unslash( $_GET['theme'] ) );
}

$ask_avi_iframe_src = add_query_arg( $ask_avi_initial_params, $ask_avi_base_url );
?>

<style id="ask-avi-kadence-overrides">
  /* Full-bleed viewport layout within Kadence / aviperera.com */
  body.page-template-page-ask-avi #primary.content-area,
  body.page-template-page-ask-avi .site-container,
  body.page-template-page-ask-avi .content-container,
  body.page-template-page-ask-avi .site-main,
  body.page-template-page-ask-avi .entry-content-wrap,
  body.page-template-page-ask-avi .entry-content {
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
    width: 100% !important;
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
  }

  .ask-avi-embed-shell {
    position: relative;
    width: 100%;
    height: calc(100vh - var(--ask-avi-header-offset, 72px));
    height: calc(100dvh - var(--ask-avi-header-offset, 72px));
    min-height: 620px;
    background: #0a0a0c;
    overflow: hidden;
  }

  html[data-theme="light"] .ask-avi-embed-shell {
    background: #f5f2eb;
  }

  body.admin-bar .ask-avi-embed-shell {
    height: calc(100vh - var(--ask-avi-header-offset, 72px) - 32px);
    height: calc(100dvh - var(--ask-avi-header-offset, 72px) - 32px);
  }

  @media screen and (max-width: 782px) {
    body.admin-bar .ask-avi-embed-shell {
      height: calc(100vh - var(--ask-avi-header-offset, 64px) - 46px);
      height: calc(100dvh - var(--ask-avi-header-offset, 64px) - 46px);
    }
  }

  .ask-avi-embed-frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
  }

  .ask-avi-fallback {
    padding: 2rem;
    text-align: center;
    font-family: system-ui, -apple-system, sans-serif;
    color: #e4e4e7;
  }

  .ask-avi-fallback a {
    color: #7c9ef8;
    text-decoration: underline;
  }
</style>

<div id="primary" class="content-area">
  <main id="main" class="site-main" role="main">
    <div class="ask-avi-embed-shell" id="ask-avi-embed-shell">
      <iframe
        id="ask-avi-frame"
        class="ask-avi-embed-frame skip-lazy no-lazyload"
        title="Ask Avi — AI Persona &amp; Research Assistant by Avi Perera"
        src="<?php echo esc_url( $ask_avi_iframe_src ); ?>"
        data-src="<?php echo esc_url( $ask_avi_iframe_src ); ?>"
        data-no-optimize="1"
        data-no-lazy="1"
        data-skip-lazy="1"
        allow="microphone; clipboard-write"
        loading="eager"
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
      <noscript>
        <div class="ask-avi-fallback">
          <p>
            JavaScript is required to run Ask Avi.
            <a href="<?php echo esc_url( $ask_avi_base_url ); ?>" target="_blank" rel="noopener noreferrer">
              Open Ask Avi directly
            </a>.
          </p>
        </div>
      </noscript>
    </div>
  </main>
</div>

<script data-no-optimize="1">
(function () {
  var frame = document.getElementById('ask-avi-frame');
  var shell = document.getElementById('ask-avi-embed-shell');
  if (!frame || !shell) return;

  var targetOrigin = 'https://a-vip.github.io';

  function detectHostTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    try {
      var stored = localStorage.getItem('avi-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) {}
    return 'dark';
  }

  function updateHeaderOffset() {
    var header = document.querySelector('#masthead, header.site-header, .kadence-header');
    if (header) {
      var h = Math.round(header.getBoundingClientRect().height);
      if (h >= 0 && h <= 180) {
        shell.style.setProperty('--ask-avi-header-offset', h + 'px');
      }
    }
  }

  function syncUrlThemeAndRecover() {
    var fallbackUrl = frame.getAttribute('data-src') || '';
    var currentSrc = frame.getAttribute('src') || '';

    // Recover if LiteSpeed stripped iframe src to about:blank
    if ((!currentSrc || currentSrc === 'about:blank') && fallbackUrl) {
      currentSrc = fallbackUrl;
    }

    try {
      var url = new URL(currentSrc || fallbackUrl);
      if (!url.searchParams.get('theme')) {
        url.searchParams.set('theme', detectHostTheme());
      }
      if (frame.src !== url.toString()) {
        frame.src = url.toString();
      }
    } catch (e) {
      if (fallbackUrl && frame.src !== fallbackUrl) {
        frame.src = fallbackUrl;
      }
    }
  }

  function sendThemeToIframe(theme) {
    try {
      if (frame.contentWindow) {
        frame.contentWindow.postMessage(
          { type: 'ask-avi:theme', theme: theme },
          targetOrigin
        );
      }
    } catch (e) {}
  }

  updateHeaderOffset();
  syncUrlThemeAndRecover();
  window.addEventListener('resize', updateHeaderOffset);

  // Sync theme transitions from aviperera.com -> Ask Avi iframe
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].attributeName === 'data-theme') {
        sendThemeToIframe(detectHostTheme());
      }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Confirm theme when Ask Avi finishes booting
  window.addEventListener('message', function (event) {
    if (event.origin !== targetOrigin) return;
    if (event.data && event.data.source === 'ask-avi' && event.data.type === 'ready') {
      sendThemeToIframe(detectHostTheme());
    }
  });
})();
</script>

<?php
get_footer();
