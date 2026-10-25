<?php
require '/var/www/html/wp-load.php';
if (!function_exists('wc_api_hash')) { throw new RuntimeException('WooCommerce is unavailable'); }
$user = get_user_by('login', 'rohit');
if (!$user || !user_can($user, 'manage_woocommerce')) { throw new RuntimeException('Store admin not found'); }
$key = 'ck_' . bin2hex(random_bytes(20));
$secret = 'cs_' . bin2hex(random_bytes(20));
global $wpdb;
$result = $wpdb->insert($wpdb->prefix . 'woocommerce_api_keys', [
    'user_id' => $user->ID, 'description' => 'Urumi Phase 2 MCP',
    'permissions' => 'read_write', 'consumer_key' => wc_api_hash($key),
    'consumer_secret' => $secret, 'truncated_key' => substr($key, -7),
]);
if (!$result) { throw new RuntimeException('Could not provision the WooCommerce REST key'); }
echo json_encode(['consumer_key' => $key, 'consumer_secret' => $secret]), "\n";
