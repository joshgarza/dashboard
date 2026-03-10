import { render, screen } from '@testing-library/react';
import { MarkdownMessage } from './MarkdownMessage.tsx';

describe('MarkdownMessage', () => {
  it('renders common markdown structures', () => {
    render(
      <MarkdownMessage
        content={[
          '# Heading',
          '',
          'A paragraph with **bold** text and `inline code`.',
          '',
          '- first item',
          '- second item',
          '',
          '```ts',
          'const answer = 42;',
          '```',
        ].join('\n')}
      />
    );

    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('inline code')).toBeInTheDocument();
    expect(screen.getByText('first item')).toBeInTheDocument();
    expect(screen.getByText('const answer = 42;')).toBeInTheDocument();
  });
});
