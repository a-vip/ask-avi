<?php
/**
 * Template Name: Ask Avi (Native Hostinger WordPress Subfolder)
 * Description: Full-viewport Ask Avi AI Persona experience at https://aviperera.com/ask-avi/
 */

if (!defined('ABSPATH')) {
  exit;
}

$ask_avi_app_url = get_template_directory_uri() . '/apps/ask-avi/?embed=1';
?><!doctype html>
<html <?php language_attributes(); ?>>
  <head>
    <meta charset="<?php bloginfo('charset'); ?>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title><?php echo esc_html(wp_get_document_title()); ?></title>
    <?php wp_head(); ?>
    <style>
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
        width: 100vw;
        height: 100dvh;
        border: 0;
        display: block;
        background: #0b0f17;
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
      src="<?php echo esc_url($ask_avi_app_url); ?>"
      title="Ask Avi — AI Persona of Avi Perera"
      allow="microphone; clipboard-write"
      loading="eager"
    ></iframe>

    <script>
      (function () {
        var frame = document.getElementById('ask-avi-host-frame');
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
