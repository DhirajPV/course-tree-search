import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

vi.stubGlobal('fetch', () => {
  throw new Error(
    'Tests must not use the network; inject fetch or a fake client',
  );
});
