<?php
declare(strict_types=1);

use App\Config;
use App\CustomerController;
use App\Database;
use App\Http;
use App\InternalController;

require dirname(__DIR__) . '/src/bootstrap.php';

$configuredOrigins = Config::get(
    'FRONTEND_ORIGINS',
    Config::get('FRONTEND_ORIGIN', 'http://localhost:4173,http://127.0.0.1:4173')
);
$allowedOrigins = array_values(array_filter(array_map('trim', explode(',', $configuredOrigins))));
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($requestOrigin !== '' && in_array($requestOrigin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $requestOrigin);
}
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Vary: Origin');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET' && $path === '/health') {
        Database::pdo()->query('SELECT 1');
        Http::json(200, ['service' => 'milktea-coffee-api', 'runtime' => 'php', 'database' => 'connected', 'status' => 'ok']);
    }

    $controller = new CustomerController(Database::pdo());
    if ($controller->handle($method, $path)) {
        exit;
    }

    $internalController = new InternalController(Database::pdo());
    if ($internalController->handle($method, $path)) {
        exit;
    }

    Http::json(404, ['code' => 'NOT_FOUND', 'message' => 'Endpoint không tồn tại']);
} catch (Throwable $error) {
    Http::error($error);
}
