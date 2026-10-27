<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreTicketRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'patient_ref' => 'required|string|max:64',
            'priority' => 'integer|in:0,1,2',
            'required_skill_id' => 'nullable|integer|exists:skills,id',
        ];
    }
}
