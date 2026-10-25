<?php
/**
 * Plugin Name: Urumi local loopback
 * Description: Connect local self-requests to Apache without the host's published port.
 */
defined('ABSPATH') || exit;

function urumi_local_loopback_rule($url) {
    $site = wp_parse_url(site_url());
    $request = wp_parse_url($url);
    // Only the configured HTTP .localhost origin belongs to this local override.
    if (!$site || !$request || ($site['scheme'] ?? '') !== 'http'
        || !str_ends_with($site['host'] ?? '', '.localhost')
        || ($request['scheme'] ?? '') !== 'http'
        || strcasecmp($request['host'] ?? '', $site['host']) !== 0
        || ($request['port'] ?? 80) !== ($site['port'] ?? 80)
        || isset($request['user']) || isset($request['pass'])) {
        return null;
    }
    return $site['host'] . ':' . ($site['port'] ?? 80) . ':127.0.0.1:80';
}

add_action('http_api_curl', function ($handle, $args, $url) {
    $rule = urumi_local_loopback_rule($url);
    if ($rule !== null) {
        // CONNECT_TO preserves the original URL, Host header, body and cookies.
        curl_setopt($handle, CURLOPT_CONNECT_TO, [$rule]);
    }
}, 10, 3);
