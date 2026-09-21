<?php
/**
 * فید استعلام‌ها برای ERP
 *
 * این فایل را در `wp-content/plugins/ata-advisor/includes/erp-feed.php` بگذارید
 * و در `ata-advisor.php` کنار بقیهٔ requireها یک خط اضافه کنید:
 *
 *     require_once ATA_DIR . 'includes/erp-feed.php';
 *
 * و در `wp-config.php` توکن مشترک را تعریف کنید (همان مقداری که در ERP وارد
 * می‌کنید؛ با `openssl rand -hex 32` بسازید):
 *
 *     define( 'ATA_ERP_FEED_TOKEN', '…' );
 *
 * ---------------------------------------------------------------------------
 *
 * چرا خواندنی و نه webhook:
 *
 * سایت عمومی است و ERP روی شبکهٔ داخلی شرکت که نباید به اینترنت باز شود، پس
 * سایت اصولاً نمی‌تواند چیزی به ERP بفرستد. بنابراین ERP هر چند دقیقه اینجا را
 * می‌خواند. نتیجهٔ مهم این است که این اندپوینت **هیچ حالتی از خودش نگه
 * نمی‌دارد**: چیزی را «منتقل‌شده» علامت نمی‌زند و چیزی را تغییر نمی‌دهد. اینکه
 * چه چیزی قبلاً منتقل شده، در خود ERP ثبت است — و این یعنی یک انتقال ناموفق
 * تبدیل به درخواستی نمی‌شود که سایت فکر می‌کند تحویل داده است.
 *
 * توکن در wp-config است و نه در تنظیمات افزونه، چون یک اعتبارنامه است و
 * wp_options از جاهای متعددی خوانده و پشتیبان‌گیری می‌شود. نبودِ توکن یعنی
 * اندپوینت اصلاً پاسخ نمی‌دهد — یک فید باز، فهرست نام و شمارهٔ تماس مشتریان را
 * در اختیار هر کسی می‌گذارد که آدرس را بداند.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/** حداقل طول قابل‌قبول توکن. کوتاه‌تر از این، عملاً بی‌توکن است. */
if ( ! defined( 'ATA_ERP_FEED_MIN_TOKEN' ) ) { define( 'ATA_ERP_FEED_MIN_TOKEN', 24 ); }

/** سقف تعداد رکورد در هر درخواست. */
if ( ! defined( 'ATA_ERP_FEED_MAX_LIMIT' ) ) { define( 'ATA_ERP_FEED_MAX_LIMIT', 50 ); }

add_action( 'rest_api_init', function () {
	register_rest_route( 'ata/v1', '/rfq/erp-feed', array(
		'methods'             => 'GET',
		'callback'            => 'ata_erp_feed',
		'permission_callback' => '__return_true', /* احراز هویت با توکن، داخل خود callback */
	) );
} );

/** توکن پیکربندی‌شده، یا رشتهٔ خالی وقتی تعریف نشده یا کوتاه‌تر از حد است. */
function ata_erp_feed_token() {
	$token = defined( 'ATA_ERP_FEED_TOKEN' ) ? (string) ATA_ERP_FEED_TOKEN : '';
	return strlen( $token ) >= ATA_ERP_FEED_MIN_TOKEN ? $token : '';
}

/** توکنی که در درخواست آمده — هدر اختصاصی یا Bearer. */
function ata_erp_feed_presented( WP_REST_Request $req ) {
	$direct = (string) $req->get_header( 'x_ata_token' );
	if ( '' !== $direct ) { return trim( $direct ); }
	$auth = (string) $req->get_header( 'authorization' );
	if ( 0 === stripos( $auth, 'bearer ' ) ) { return trim( substr( $auth, 7 ) ); }
	return '';
}

/**
 * استعلام‌های ثبت‌شده، از شمارهٔ خواسته‌شده به بعد.
 *
 * فقط وضعیت‌های `submitted` و `emailed` برگردانده می‌شوند: یک درخواست `pending`
 * هنوز فرم تماسش پر نشده و مشتری‌ای ندارد که ساخته شود، و `declined` یعنی
 * کاربر همان‌جا منصرف شده.
 *
 * ترتیب **نزولی** است تا اولین همگام‌سازی (که `since_id=0` می‌فرستد و سقف کمی
 * دارد) تازه‌ترین‌ها را بردارد، نه قدیمی‌ترین‌ها را — شرکتی که این را روشن
 * می‌کند دنبال استعلام‌هایی است که هنوز رویشان کار می‌کند.
 *
 * متن کامل گفتگو عمداً برگردانده نمی‌شود: ممکن است ده‌ها پیام باشد، در هر
 * نظرسنجی تکرار می‌شود، و چیزی که برای صدور پیش‌فاکتور لازم است همان مشخصات
 * تأییدشده است. لینک پنل همراه می‌رود تا هر وقت لازم شد، اصل گفتگو یک کلیک
 * دورتر باشد.
 */
function ata_erp_feed( WP_REST_Request $req ) {
	$token = ata_erp_feed_token();
	if ( '' === $token ) {
		/* بسته به پیش‌فرض: بدون توکن پیکربندی‌شده، اصلاً پاسخی داده نمی‌شود. */
		return new WP_Error( 'erp_feed_off', 'فید ERP پیکربندی نشده است.', array( 'status' => 503 ) );
	}
	$presented = ata_erp_feed_presented( $req );
	if ( '' === $presented || ! hash_equals( $token, $presented ) ) {
		return new WP_Error( 'erp_feed_auth', 'توکن معتبر نیست.', array( 'status' => 401 ) );
	}

	$since = max( 0, (int) $req->get_param( 'since_id' ) );
	$limit = (int) $req->get_param( 'limit' );
	if ( $limit <= 0 ) { $limit = 20; }
	$limit = min( ATA_ERP_FEED_MAX_LIMIT, $limit );

	global $wpdb;
	$t = ata_t_rfqs();
	$rows = (array) $wpdb->get_results( $wpdb->prepare(
		"SELECT id, conv_id, product_id, product_name, product_url, specs,
		        full_name, company, mobile, email, customer_notes, submitted_at
		   FROM $t
		  WHERE id > %d AND status IN ('submitted','emailed')
		  ORDER BY id DESC
		  LIMIT %d",
		$since, $limit
	) );

	$items = array();
	foreach ( $rows as $r ) {
		$items[] = array(
			'id'             => (int) $r->id,
			'full_name'      => (string) $r->full_name,
			'company'        => (string) $r->company,
			'mobile'         => (string) $r->mobile,
			'email'          => (string) $r->email,
			'customer_notes' => (string) $r->customer_notes,
			'product_id'     => (int) $r->product_id,
			'product_name'   => (string) $r->product_name,
			'product_url'    => (string) $r->product_url,
			'specs'          => (string) $r->specs,
			'panel_url'      => admin_url( 'admin.php?page=ata-advisor&tab=inbox&conv=' . (int) $r->conv_id ),
			'submitted_at'   => (string) $r->submitted_at,
		);
	}

	/*
	 * بالاترین شمارهٔ استعلام روی سایت، **با هر وضعیتی**.
	 *
	 * ERP اولین بار که وصل می‌شود همین را به‌عنوان «خط» ذخیره می‌کند و هر چه
	 * شمارهٔ کوچک‌تر یا مساوی دارد را هرگز منتقل نمی‌کند — استعلام‌های قبلی
	 * دستی ثبت شده‌اند و انتقالشان یعنی یک پروژهٔ تکراری کنار هرکدام.
	 *
	 * عمداً بالاترین شمارهٔ **کل جدول** است و نه بالاترین چیزی که در فهرست
	 * بالا آمد: فهرست فقط استعلام‌های ثبت‌شده را دارد، پس درخواستی که تایپ
	 * شده و هنوز فرستاده نشده شماره‌ای بالاتر از همهٔ آن‌ها دارد و اگر خط را
	 * از فهرست می‌گرفتیم، لحظه‌ای که فرستاده می‌شد «تازه» خوانده می‌شد.
	 */
	$max_id = (int) $wpdb->get_var( "SELECT MAX(id) FROM $t" );

	return array( 'items' => $items, 'max_id' => $max_id );
}
