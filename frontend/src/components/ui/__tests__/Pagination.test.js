import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import Pagination from '../Pagination.jsx';

describe('Pagination component', () => {
  it('renders item range summary and navigation buttons', () => {
    const html = renderToString(
      <Pagination
        currentPage={1}
        totalPages={10}
        totalItems={500}
        pageSize={50}
        onPageChange={() => {}}
      />
    );
    expect(html).toMatch(/Showing.*1.*50.*of.*500/);
    expect(html).toContain('Previous');
    expect(html).toContain('Next');
    expect(html).toContain('1');
    expect(html).toContain('10');
  });

  it('renders disabled Previous on first page and disabled Next on last page', () => {
    const htmlFirst = renderToString(
      <Pagination
        currentPage={1}
        totalPages={5}
        totalItems={250}
        pageSize={50}
        onPageChange={() => {}}
      />
    );
    expect(htmlFirst).toMatch(/disabled=""[^>]*>Previous/);

    const htmlLast = renderToString(
      <Pagination
        currentPage={5}
        totalPages={5}
        totalItems={250}
        pageSize={50}
        onPageChange={() => {}}
      />
    );
    expect(htmlLast).toMatch(/disabled=""[^>]*>Next/);
  });

  it('renders page size selector when onPageSizeChange is provided', () => {
    const html = renderToString(
      <Pagination
        currentPage={2}
        totalPages={10}
        totalItems={500}
        pageSize={50}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />
    );
    expect(html).toMatch(/50.*\/ page/);
  });
});
