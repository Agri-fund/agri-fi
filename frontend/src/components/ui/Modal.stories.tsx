import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ModalWrapper } from './ModalWrapper';
import { Button } from './Button';

const meta: Meta<typeof ModalWrapper> = {
  title: 'UI/Modal',
  component: ModalWrapper,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof ModalWrapper>;

function Demo({ isDirty = false, initiallyOpen = false }: { isDirty?: boolean; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="p-8">
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <ModalWrapper isOpen={open} onClose={() => setOpen(false)} isDirty={isDirty} labelledBy="modal-title">
        <div className="p-6 w-96">
          <h2 id="modal-title" className="text-lg font-semibold mb-2">Confirm investment</h2>
          <p className="text-sm mb-4">
            {isDirty ? 'Escape and backdrop clicks are ignored while the form is dirty.' : 'Press Escape or click outside to close.'}
          </p>
          <Button variant="secondary" data-autofocus onClick={() => setOpen(false)}>Close</Button>
        </div>
      </ModalWrapper>
    </div>
  );
}

export const Default: Story = { render: () => <Demo initiallyOpen /> };
export const Closed: Story = { render: () => <Demo /> };
/** Edge case: unsaved edits block Escape and backdrop dismissal. */
export const Dirty: Story = { render: () => <Demo isDirty initiallyOpen /> };
