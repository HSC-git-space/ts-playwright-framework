interface Post {
  id: number;
  title: string;
  body: string;
  userId: number;
}

import { test, expect } from '@playwright/test';

test('GET /posts/1 returns correct shape', async ({ request }) => {
  const response = await request.get('https://jsonplaceholder.typicode.com/posts/1');
  expect(response.status()).toBe(200);

  const post: Post = await response.json();
  expect(post.id).toBe(1);
  expect(typeof post.title).toBe('string');
  expect(typeof post.body).toBe('string');
  expect(typeof post.userId).toBe('number');
});