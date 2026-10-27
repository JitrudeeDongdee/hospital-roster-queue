# waka-crud

A small Product CRUD REST API built with Laravel 13 (PHP 8.5).

## What it covers

- Migration, Eloquent model with `$fillable` (mass-assignment protection)
- Form Request validation (`StoreProductRequest`, `UpdateProductRequest`) — invalid input returns `422`
- API resource controller with route model binding — missing records return `404`
- `Route::apiResource` for all five endpoints, paginated listing

## Endpoints

| Method | Path | Result |
|---|---|---|
| GET | `/api/products` | Paginated list (10 per page) |
| POST | `/api/products` | Create → `201` |
| GET | `/api/products/{id}` | Show one |
| PUT/PATCH | `/api/products/{id}` | Update |
| DELETE | `/api/products/{id}` | Delete → `204` |

## Run locally

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve
```

Uses SQLite by default. To use MySQL, set `DB_CONNECTION=mysql` and the `DB_*` values in `.env`, then run `php artisan migrate`.

## Try it

```bash
curl -X POST http://127.0.0.1:8000/api/products \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{"name":"Spica Bear Plush","price":590,"stock":20}'
```
