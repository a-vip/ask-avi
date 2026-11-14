<?php
/**
 * Template Name: Ask Avi (Native Hostinger WordPress Subfolder)
 * Description: Full-viewport Ask Avi AI Persona experience at https://aviperera.com/ask-avi/
 */

if (!defined('ABSPATH')) {
  exit;
}

$ask_avi_app_url = get_template_directory_uri() . '/apps/ask-avi/index.html?v=20261114e';
?><!doctype html>
<html <?php language_attributes(); ?>>
  <head>
    <meta charset="<?php bloginfo('charset'); ?>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title><?php echo esc_html(wp_get_document_title()); ?></title>
    <?php wp_head(); ?>
    <style data-no-optimize="1">
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0b0f17;
      }
      #ask-avi-host-frame {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        width: 100vw;
        height: 100dvh;
        border: 0;
        display: block;
        background: #0b0f17;
      }
      #kt-scroll-up,
      .kt-scroll-up-wrap {
        display: none !important;
      }
      html[data-ask-avi-theme='light'],
      html[data-ask-avi-theme='light'] body,
      html[data-ask-avi-theme='light'] #ask-avi-host-frame {
        background: #faf8f5;
      }
    </style>
  </head>
  <body <?php body_class('ask-avi-page-template'); ?>>
    <iframe
      id="ask-avi-host-frame"
      class="skip-lazy no-lazyload"
      data-no-lazy="1"
      data-skip-lazy="1"
      src="<?php echo esc_url($ask_avi_app_url); ?>"
      title="Ask Avi — AI Persona of Avi Perera"
      allow="microphone; clipboard-write"
      loading="eager"
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>

    <script data-no-optimize="1">
      (function () {
        var frame = document.getElementById('ask-avi-host-frame');
        var defaultUrl = <?php echo wp_json_encode($ask_avi_app_url); ?>;
        if (!frame) return;

        // Recover immediately if LiteSpeed or another optimizer lazy-replaces src with about:blank on mobile
        try {
          var rawSrc = frame.getAttribute('data-litespeed-src') || frame.getAttribute('data-src') || frame.getAttribute('src') || defaultUrl;
          if (!rawSrc || rawSrc === 'about:blank' || rawSrc.indexOf('about:blank') === 0) {
            rawSrc = defaultUrl;
          }
          var targetUrl = new URL(rawSrc, window.location.origin);
          if (window.location.search) {
            var parentParams = new URLSearchParams(window.location.search);
            parentParams.forEach(function (val, key) {
              targetUrl.searchParams.set(key, val);
            });
          }
          var finalHref = targetUrl.toString();
          if (frame.src !== finalHref) {
            frame.src = finalHref;
          }
        } catch (e) {
          frame.src = defaultUrl;
        }

        window.addEventListener('message', function (event) {
          if (!frame || !event.data || event.data.source !== 'ask-avi') return;
          if (event.data.event === 'theme-change' && event.data.theme) {
            document.documentElement.setAttribute('data-ask-avi-theme', event.data.theme);
          }
        });
      })();
    </script>
    <?php wp_footer(); ?>
  </body>
</html>
