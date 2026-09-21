<?php
/**
 * فید فرم استعلام قیمت برای ERP
 *
 * این فایل را در `wp-content/plugins/ata-smart-rfq/includes/erp-feed.php` بگذارید
 * و در `ata-smart-rfq.php` کنار بقیهٔ requireها یک خط اضافه کنید:
 *
 *     require_once ATA_RFQ_DIR . 'includes/erp-feed.php';
 *
 * توکن **همان** `ATA_ERP_FEED_TOKEN` در `wp-config.php` است که افزونهٔ مشاور
 * هم از آن استفاده می‌کند؛ یک سایت، یک اعتبارنامه.
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
 * چرا مسیر و نام‌فضای جدا از فید مشاور:
 *
 * دو افزونه، دو جدول، و هر کدام شماره‌گذاری مستقل خودش را دارد — پس ERP هم دو
 * «منبع» جدا می‌شناسد و کلید یکتایش (منبع، شماره) است. اگر هر دو یک شماره‌گذاری
 * فرض می‌شدند، درخواست شمارهٔ ۹ این افزونه به بهانهٔ شمارهٔ ۹ افزونهٔ مشاور
 * «قبلاً منتقل شده» خوانده می‌شد و **بی‌صدا** از دست می‌رفت.
 *
 * توابع مشترکِ توکن با `function_exists` محافظت شده‌اند تا اگر فایل فید مشاور هم
 * نصب باشد، تعریف دوباره‌شان خطای fatal ندهد — و اگر نباشد، همین فایل تعریفشان
 * کند.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/** حداقل طول قابل‌قبول توکن. کوتاه‌تر از این، عملاً بی‌توکن است. */
if ( ! defined( 'ATA_ERP_FEED_MIN_TOKEN' ) ) { define( 'ATA_ERP_FEED_MIN_TOKEN', 24 ); }

/** سقف تعداد رکورد در هر درخواست. */
if ( ! defined( 'ATA_ERP_FEED_MAX_LIMIT' ) ) { define( 'ATA_ERP_FEED_MAX_LIMIT', 50 ); }

if ( ! function_exists( 'ata_erp_feed_token' ) ) {
	/** توکن پیکربندی‌شده، یا رشتهٔ خالی وقتی تعریف نشده یا کوتاه‌تر از حد است. */
	function ata_erp_feed_token() {
		$token = defined( 'ATA_ERP_FEED_TOKEN' ) ? (string) ATA_ERP_FEED_TOKEN : '';
		return strlen( $token ) >= ATA_ERP_FEED_MIN_TOKEN ? $token : '';
	}
}

if ( ! function_exists( 'ata_erp_feed_presented' ) ) {
	/** توکنی که در درخواست آمده — هدر اختصاصی یا Bearer. */
	function ata_erp_feed_presented( WP_REST_Request $req ) {
		$direct = (string) $req->get_header( 'x_ata_token' );
		if ( '' !== $direct ) { return trim( $direct ); }
		$auth = (string) $req->get_header( 'authorization' );
		if ( 0 === stripos( $auth, 'bearer ' ) ) { return trim( substr( $auth, 7 ) ); }
		return '';
	}
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'ata-rfq/v1', '/erp-feed', array(
		'methods'             => 'GET',
		'callback'            => 'ata_rfq_erp_feed',
		'permission_callback' => '__return_true', /* احراز هویت با توکن، داخل خود callback */
	) );
} );

/**
 * مشخصات یک قلم، به‌صورت «برچسب: مقدار» در هر سطر.
 *
 * همان چیزی که در ایمیل هم چاپ می‌شود: برچسب‌ها از قالب همان قلم خوانده
 * می‌شوند (نه کلید خام)، مقدارهای خالی و `no` (تیک نخورده) حذف می‌شوند و
 * چیزی که می‌ماند دقیقاً همان است که فروش برای صدور پیش‌فاکتور لازم دارد.
 */
function ata_rfq_erp_specs( $template_key, $data ) {
	if ( ! is_array( $data ) || ! $data ) { return ''; }
	$labels = class_exists( 'ATA_RFQ_Templates' ) ? ATA_RFQ_Templates::field_labels( $template_key ) : array();
	$lines = array();
	foreach ( $data as $key => $value ) {
		if ( ! is_scalar( $value ) ) { continue; }
		$value = trim( (string) $value );
		if ( '' === $value || 'no' === $value ) { continue; }
		if ( 'yes' === $value ) { $value = 'بله'; }
		$label = isset( $labels[ $key ] ) ? $labels[ $key ] : $key;
		$lines[] = $label . ': ' . $value;
	}
	return implode( "\n", $lines );
}

/**
 * درخواست‌های ثبت‌شده، از شمارهٔ خواسته‌شده به بعد.
 *
 * **هیچ فیلتری روی وضعیت نیست، و این یک تصمیم است.** برخلاف فید مشاور — که
 * وضعیت `pending` در آن یعنی فرم تماس هنوز پر نشده و مشتری‌ای برای ساختن وجود
 * ندارد — اینجا هر سطر یعنی فرمی که با نام و موبایل و ایمیل معتبر ارسال شده؛
 * `reviewing` و `quoted` و `closed` فقط می‌گویند کارشناس سایت کجای کار است.
 * اگر بر اساس وضعیت فیلتر می‌کردیم، درخواستی که در پنل سایت چند دقیقه پس از
 * ثبت «پاسخ داده‌شده» علامت خورده بود — یعنی قبل از همگام‌سازی بعدی ERP —
 * هرگز منتقل نمی‌شد. «چه چیزی قبلاً منتقل شده» را خودِ ERP می‌داند.
 *
 * ترتیب **نزولی** است تا اولین همگام‌سازی (که `since_id=0` می‌فرستد و سقف کمی
 * دارد) تازه‌ترین‌ها را بردارد، نه قدیمی‌ترین‌ها را.
 *
 * اقلام و تعداد پیوست‌ها هر کدام با **یک** کوئری برای کل صفحه خوانده می‌شوند و
 * نه یک کوئری به ازای هر سطر.
 */
function ata_rfq_erp_feed( WP_REST_Request $req ) {
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
	$requests_table = ATA_RFQ_Installer::table( 'requests' );
	$items_table    = ATA_RFQ_Installer::table( 'items' );
	$files_table    = ATA_RFQ_Installer::table( 'files' );

	$rows = (array) $wpdb->get_results( $wpdb->prepare(
		"SELECT id, reference, request_mode, customer_name, company, mobile, email,
		        city, deadline, note, created_at
		   FROM $requests_table
		  WHERE id > %d
		  ORDER BY id DESC
		  LIMIT %d",
		$since, $limit
	) );

	$ids = array();
	foreach ( $rows as $r ) { $ids[] = (int) $r->id; }

	$lines_by_request = array();
	$files_by_request = array();
	if ( $ids ) {
		$in = implode( ',', array_map( 'absint', $ids ) );
		$item_rows = (array) $wpdb->get_results( // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			"SELECT request_id, product_id, product_name, quantity, template_key, data_json
			   FROM $items_table WHERE request_id IN ($in) ORDER BY id ASC"
		);
		foreach ( $item_rows as $item ) {
			$rid = (int) $item->request_id;
			if ( ! isset( $lines_by_request[ $rid ] ) ) { $lines_by_request[ $rid ] = array(); }
			$data = json_decode( (string) $item->data_json, true );
			$lines_by_request[ $rid ][] = array(
				'product_id'   => (int) $item->product_id,
				'product_name' => (string) $item->product_name,
				'quantity'     => (float) $item->quantity,
				'specs'        => ata_rfq_erp_specs( (string) $item->template_key, $data ),
			);
		}

		$file_rows = (array) $wpdb->get_results( // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			"SELECT request_id, COUNT(*) AS c FROM $files_table WHERE request_id IN ($in) GROUP BY request_id"
		);
		foreach ( $file_rows as $file ) {
			$files_by_request[ (int) $file->request_id ] = (int) $file->c;
		}
	}

	$items = array();
	foreach ( $rows as $r ) {
		$rid = (int) $r->id;
		$items[] = array(
			'id'               => $rid,
			'reference'        => (string) $r->reference,
			'request_mode'     => (string) $r->request_mode,
			'full_name'        => (string) $r->customer_name,
			'company'          => (string) $r->company,
			'mobile'           => (string) $r->mobile,
			'email'            => (string) $r->email,
			'city'             => (string) $r->city,
			'deadline'         => (string) $r->deadline,
			'customer_notes'   => (string) $r->note,
			/*
			 * پیوست‌ها فقط شمرده می‌شوند و فرستاده نمی‌شوند: خود افزونه آن‌ها را
			 * بیرون از دسترس وب نگه می‌دارد و تنها به مدیرِ واردشده می‌دهد، پس
			 * ERP نمی‌تواند و نباید آن‌ها را بردارد. شمردنشان کنار لینک پنل،
			 * صادقانه‌ترین پاسخ است — پروژه‌ای که ادعا کند فایل دارد و نداشته
			 * باشد، از پروژه‌ای که بگوید فایل‌ها کجاست بدتر است.
			 */
			'attachment_count' => isset( $files_by_request[ $rid ] ) ? $files_by_request[ $rid ] : 0,
			'lines'            => isset( $lines_by_request[ $rid ] ) ? $lines_by_request[ $rid ] : array(),
			'panel_url'        => admin_url( 'admin.php?page=ata-rfq&request_id=' . $rid ),
			'submitted_at'     => (string) $r->created_at,
		);
	}

	/*
	 * بالاترین شمارهٔ درخواست روی سایت.
	 *
	 * ERP اولین بار که وصل می‌شود همین را به‌عنوان «خط» ذخیره می‌کند و هر چه
	 * شمارهٔ کوچک‌تر یا مساوی دارد را هرگز منتقل نمی‌کند — درخواست‌های قبلی
	 * دستی ثبت شده‌اند و انتقالشان یعنی یک پروژهٔ تکراری کنار هرکدام.
	 *
	 * از کل جدول خوانده می‌شود و نه از فهرست بالا؛ اینجا چون فیلتر وضعیتی در
	 * کار نیست این دو یکی درمی‌آیند، ولی خواندنش از جدول همان چیزی را می‌گوید
	 * که باید — «شماره‌گذاری سایت تا کجا رسیده» — و اگر روزی فیلتری اضافه شد،
	 * جواب همچنان درست می‌ماند.
	 */
	$max_id = (int) $wpdb->get_var( "SELECT MAX(id) FROM $requests_table" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared

	return array( 'items' => $items, 'max_id' => $max_id );
}
