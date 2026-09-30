import { describe, expect, it } from 'vitest';

describe('test setup', () => {
  it('blocks network access through the global fetch', () => {
    expect(() => fetch('/api/?query=a')).toThrow(
      'Tests must not use the network; inject fetch or a fake client',
    );
  });

  it('registers the jest-dom matchers', () => {
    document.body.innerHTML = '<p>ready</p>';

    expect(document.querySelector('p')).toHaveTextContent('ready');
  });
});
