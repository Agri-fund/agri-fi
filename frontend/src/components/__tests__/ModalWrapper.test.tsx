import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalWrapper } from '../ui/ModalWrapper';

function ModalContent() {
  return (
    <>
      <button>First</button>
      <button>Second</button>
      <button>Third</button>
    </>
  );
}

describe('ModalWrapper', () => {
  it('renders nothing when isOpen is false', () => {
    render(
      <ModalWrapper isOpen={false} onClose={jest.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders children with dialog semantics when isOpen is true', () => {
    render(
      <ModalWrapper isOpen onClose={jest.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('First')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={onClose}>
        <ModalContent />
      </ModalWrapper>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on Escape when isDirty is true', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={onClose} isDirty>
        <ModalContent />
      </ModalWrapper>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={onClose}>
        <ModalContent />
      </ModalWrapper>,
    );

    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the dialog panel', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={onClose}>
        <ModalContent />
      </ModalWrapper>,
    );

    await user.click(screen.getByText('First'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not call onClose on backdrop click when isDirty is true', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={onClose} isDirty>
        <ModalContent />
      </ModalWrapper>,
    );

    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus to the first focusable element when opened', () => {
    render(
      <ModalWrapper isOpen onClose={jest.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(screen.getByText('First')).toHaveFocus();
  });

  it('wraps Tab from the last focusable element back to the first (focus trap)', async () => {
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={jest.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    screen.getByText('Third').focus();
    await user.tab();

    expect(screen.getByText('First')).toHaveFocus();
  });

  it('wraps Shift+Tab from the first focusable element back to the last (focus trap)', async () => {
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={jest.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(screen.getByText('First')).toHaveFocus();
    await user.tab({ shift: true });

    expect(screen.getByText('Third')).toHaveFocus();
  });

  it('restores focus to the previously-focused element after closing', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { rerender } = render(
      <ModalWrapper isOpen onClose={jest.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(screen.getByText('First')).toHaveFocus();

    rerender(
      <ModalWrapper isOpen={false} onClose={jest.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(trigger).toHaveFocus();
    document.body.removeChild(trigger);
  });

  it('does not throw and stops tabbing when there are no focusable elements', async () => {
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={jest.fn()}>
        <p>No interactive elements here.</p>
      </ModalWrapper>,
    );

    await expect(user.tab()).resolves.not.toThrow();
  });
});
