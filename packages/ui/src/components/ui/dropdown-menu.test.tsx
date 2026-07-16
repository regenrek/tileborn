import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
import { Button } from './button.js';

describe('DropdownMenu', () => {
  it('opens menu content when trigger is clicked', async () => {
    const user = userEvent.setup();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button>Open menu</Button>} />
        <DropdownMenuContent>
          <DropdownMenuItem>Recent maps</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.queryByText('Recent maps')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(await screen.findByText('Recent maps')).toBeInTheDocument();
  });
});
