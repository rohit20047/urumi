<?php
// Run through kubectl exec -i ... -- php /dev/stdin [create-marker].
require '/var/www/html/wp-load.php';
if (!class_exists('WooCommerce')) { throw new RuntimeException('WooCommerce is missing'); }
$product = wc_get_product(wc_get_product_id_by_sku('URUMI-DEMO-001'));
if (!$product || $product->get_status() !== 'publish') {
    throw new RuntimeException('Published demo product is missing');
}
$orders = wc_get_orders(['limit' => 10, 'orderby' => 'ID', 'order' => 'ASC']);
if (!$orders) { throw new RuntimeException('No checkout order exists'); }
$uploads = wp_upload_dir();
$marker = $uploads['basedir'] . '/urumi-phase1-persistence.txt';
if (($argv[1] ?? '') === 'create-marker') {
    if (!wp_mkdir_p($uploads['basedir'])) { throw new RuntimeException('Cannot create uploads directory'); }
    if (file_put_contents($marker, "Urumi Phase 1 persistent WordPress content\n") === false) {
        throw new RuntimeException('Cannot write persistence marker');
    }
}
if (!is_file($marker)) { throw new RuntimeException('Persistent uploads marker is missing'); }
echo json_encode([
    'wordpress' => get_bloginfo('version'),
    'woocommerce' => WC_VERSION,
    'product' => ['id' => $product->get_id(), 'price' => $product->get_price()],
    'orders' => array_map(fn($o) => [
        'id' => $o->get_id(), 'status' => $o->get_status(),
        'total' => $o->get_total(), 'payment' => $o->get_payment_method()
    ], $orders),
    'plugin_sha256' => hash_file('sha256', WP_PLUGIN_DIR . '/woocommerce/woocommerce.php'),
    'uploads_sha256' => hash_file('sha256', $marker)
], JSON_PRETTY_PRINT) . PHP_EOL;
