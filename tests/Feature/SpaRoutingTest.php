<?php

namespace Tests\Feature;

use Tests\TestCase;

class SpaRoutingTest extends TestCase
{
    public function test_every_page_url_serves_the_react_app(): void
    {
        $this->withoutVite();

        foreach (['/', '/login', '/roster/calendar', '/roster/doctors/3?month=2026-11', '/queue?status=waiting', '/roles', '/not/a/page'] as $url) {
            $this->get($url)->assertOk()->assertSee('<div id="app"></div>', false);
        }
    }

    public function test_api_paths_are_not_swallowed_by_the_page_route(): void
    {
        $this->getJson('/api/does-not-exist')->assertNotFound()->assertHeader('content-type', 'application/json');
        $this->getJson('/api/me')->assertUnauthorized();
    }
}
