<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Models\Product;

class ProductController extends Controller
{
    // GET /api/products
    public function index()
    {
        return Product::latest()->paginate(10);
    }

    // POST /api/products
    public function store(StoreProductRequest $request)
    {
        $product = Product::create($request->validated());

        return response()->json($product, 201);
    }

    // GET /api/products/{product}  (route model binding → ไม่เจอ = 404 เอง)
    public function show(Product $product)
    {
        return $product;
    }

    // PUT/PATCH /api/products/{product}
    public function update(UpdateProductRequest $request, Product $product)
    {
        $product->update($request->validated());

        return $product;
    }

    // DELETE /api/products/{product}
    public function destroy(Product $product)
    {
        $product->delete();

        return response()->noContent();
    }
}
