<?php
/**
 * Plugin Name:       ReviewDesk
 * Description:       Ajoute le bouton de relecture ReviewDesk à votre site : vos clients pointent un élément et envoient leur retour. Collez simplement la ligne d’installation copiée depuis ReviewDesk.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            ReviewDesk
 * License:           Propriétaire
 * Text Domain:       reviewdesk
 */

if (!defined('ABSPATH')) {
	exit;
}

const REVIEWDESK_OPTION = 'reviewdesk_settings';

/**
 * Turns whatever was pasted (the whole <script> line, or just its URL) into
 * the widget URL, or null when it is not one. Only an http(s) URL ending in
 * /widget.js, carrying a project id and a reviewer token in its fragment, is
 * accepted; everything is rebuilt from validated parts, nothing is passed on.
 */
function reviewdesk_parse_install_line($raw) {
	$raw = trim((string) $raw);
	if (preg_match('/src\s*=\s*["\']([^"\']+)["\']/i', $raw, $match)) {
		$raw = $match[1];
	}
	$raw = html_entity_decode($raw, ENT_QUOTES);
	$parts = wp_parse_url($raw);
	if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host']) || empty($parts['path'])) {
		return null;
	}
	if (!in_array(strtolower($parts['scheme']), array('https', 'http'), true)) {
		return null;
	}
	if (!preg_match('#/widget\.js$#', $parts['path'])) {
		return null;
	}
	parse_str(isset($parts['fragment']) ? $parts['fragment'] : '', $fragment);
	$project = isset($fragment['project']) ? (string) $fragment['project'] : '';
	$token = isset($fragment['token']) ? (string) $fragment['token'] : '';
	if (!preg_match('/^[0-9a-f-]{36}$/', $project) || !preg_match('/^[A-Za-z0-9_-]{20,200}$/', $token)) {
		return null;
	}
	$origin = strtolower($parts['scheme']) . '://' . $parts['host'] . (isset($parts['port']) ? ':' . (int) $parts['port'] : '');
	$settings = array('project' => $project, 'token' => $token);
	foreach (array('label', 'position', 'theme', 'accent') as $key) {
		if (isset($fragment[$key]) && preg_match('/^[\p{L}\p{N} #\'’.,!?-]{1,40}$/u', (string) $fragment[$key])) {
			$settings[$key] = (string) $fragment[$key];
		}
	}
	return $origin . $parts['path'] . '#' . http_build_query($settings, '', '&', PHP_QUERY_RFC3986);
}

function reviewdesk_settings() {
	$saved = get_option(REVIEWDESK_OPTION, array());
	return wp_parse_args(is_array($saved) ? $saved : array(), array('url' => '', 'audience' => 'everyone'));
}

function reviewdesk_sanitize($input) {
	$current = reviewdesk_settings();
	$output = array(
		'url' => $current['url'],
		'audience' => (isset($input['audience']) && 'logged_in' === $input['audience']) ? 'logged_in' : 'everyone',
	);
	$line = isset($input['line']) ? (string) $input['line'] : '';
	if ('' === trim($line)) {
		$output['url'] = '';
		return $output;
	}
	$url = reviewdesk_parse_install_line($line);
	if (null === $url) {
		add_settings_error(REVIEWDESK_OPTION, 'reviewdesk_invalid', __('Cette ligne n’est pas une ligne d’installation ReviewDesk. Copiez-la à nouveau depuis ReviewDesk (Installer › WordPress).', 'reviewdesk'));
		return $output;
	}
	$output['url'] = $url;
	add_settings_error(REVIEWDESK_OPTION, 'reviewdesk_saved', __('Le bouton de relecture est installé. Ouvrez votre site pour le voir.', 'reviewdesk'), 'success');
	return $output;
}

add_action('admin_init', function () {
	register_setting('reviewdesk', REVIEWDESK_OPTION, array('sanitize_callback' => 'reviewdesk_sanitize'));
});

add_action('admin_menu', function () {
	add_options_page('ReviewDesk', 'ReviewDesk', 'manage_options', 'reviewdesk', 'reviewdesk_render_settings');
});

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
	array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=reviewdesk')) . '">' . esc_html__('Réglages', 'reviewdesk') . '</a>');
	return $links;
});

function reviewdesk_render_settings() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$settings = reviewdesk_settings();
	?>
	<div class="wrap">
		<h1>ReviewDesk</h1>
		<p><?php esc_html_e('Collez ci-dessous la ligne d’installation copiée dans ReviewDesk (Installer › WordPress), puis enregistrez. Le bouton « Faire un retour » apparaît alors sur votre site.', 'reviewdesk'); ?></p>
		<?php settings_errors(REVIEWDESK_OPTION); ?>
		<form method="post" action="options.php">
			<?php settings_fields('reviewdesk'); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="reviewdesk-line"><?php esc_html_e('Ligne d’installation', 'reviewdesk'); ?></label></th>
					<td>
						<textarea id="reviewdesk-line" name="<?php echo esc_attr(REVIEWDESK_OPTION); ?>[line]" rows="3" class="large-text code" placeholder="&lt;script src=&quot;https://…/widget.js#project=…&quot;&gt;&lt;/script&gt;"><?php echo esc_textarea($settings['url'] ? '<script src="' . $settings['url'] . '" defer></script>' : ''); ?></textarea>
						<p class="description"><?php esc_html_e('Videz le champ et enregistrez pour retirer le bouton.', 'reviewdesk'); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e('Afficher le bouton', 'reviewdesk'); ?></th>
					<td>
						<fieldset>
							<label><input type="radio" name="<?php echo esc_attr(REVIEWDESK_OPTION); ?>[audience]" value="everyone" <?php checked($settings['audience'], 'everyone'); ?>> <?php esc_html_e('À tous les visiteurs (site de préproduction)', 'reviewdesk'); ?></label><br>
							<label><input type="radio" name="<?php echo esc_attr(REVIEWDESK_OPTION); ?>[audience]" value="logged_in" <?php checked($settings['audience'], 'logged_in'); ?>> <?php esc_html_e('Aux utilisateurs connectés uniquement (site en ligne)', 'reviewdesk'); ?></label>
						</fieldset>
					</td>
				</tr>
			</table>
			<?php submit_button(__('Enregistrer', 'reviewdesk')); ?>
		</form>
	</div>
	<?php
}

/*
 * Printed by hand rather than enqueued: wp_enqueue_script() appends ?ver= to
 * the URL, which would land after the fragment and break the settings.
 */
add_action('wp_footer', function () {
	$settings = reviewdesk_settings();
	if ('' === $settings['url']) {
		return;
	}
	if ('logged_in' === $settings['audience'] && !is_user_logged_in()) {
		return;
	}
	echo '<script src="' . esc_url($settings['url']) . '" defer></script>' . "\n";
}, 100);

register_uninstall_hook(__FILE__, 'reviewdesk_uninstall');

function reviewdesk_uninstall() {
	delete_option(REVIEWDESK_OPTION);
}
