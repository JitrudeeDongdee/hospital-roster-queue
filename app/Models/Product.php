<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    // กัน mass assignment: กรอกได้เฉพาะคอลัมน์เหล่านี้
    protected $fillable = ['name', 'description', 'price', 'stock'];
}
