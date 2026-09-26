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
      <ModalWrapper isOpen={false} onClose={vi.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders children with dialog semantics when isOpen is true', () => {
    render(
      <ModalWrapper isOpen onClose={vi.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('First')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
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
    const onClose = vi.fn();
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
    const onClose = vi.fn();
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
    const onClose = vi.fn();
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
    const onClose = vi.fn();
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
      <ModalWrapper isOpen onClose={vi.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(screen.getByText('First')).toHaveFocus();
  });

  it('wraps Tab from the last focusable element back to the first (focus trap)', async () => {
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={vi.fn()}>
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
      <ModalWrapper isOpen onClose={vi.fn()}>
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
      <ModalWrapper isOpen onClose={vi.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(screen.getByText('First')).toHaveFocus();

    rerender(
      <ModalWrapper isOpen={false} onClose={vi.fn()}>
        <ModalContent />
      </ModalWrapper>,
    );

    expect(trigger).toHaveFocus();
    document.body.removeChild(trigger);
  });

  it('does not throw and stops tabbing when there are no focusable elements', async () => {
    const user = userEvent.setup();
    render(
      <ModalWrapper isOpen onClose={vi.fn()}>
        <p>No interactive elements here.</p>
      </ModalWrapper>,
    );

    await expect(user.tab()).resolves.not.toThrow();
  });

  it('labels the dialog via ariaLabel when no labelledBy is given', () => {
    render(
      <ModalWrapper isOpen onClose={vi.fn()} ariaLabel="Invest">
        <ModalContent />
      </ModalWrapper>,
    );

    expect(screen.getByRole('dialog', { name: 'Invest' })).toBeInTheDocument();
  });

  it('focuses the element marked data-autofocus instead of the first focusable', () => {
    render(
      <ModalWrapper isOpen onClose={vi.fn()}>
        <button>Close</button>
        <input aria-label="Amount" data-autofocus />
      </ModalWrapper>,
    );

    expect(screen.getByLabelText('Amount')).toHaveFocus();
  });

  describe('nested modals', () => {
    function Nested({ onOuterClose, onInnerClose, innerOpen = true }: {
      onOuterClose: () => void;
      onInnerClose: () => void;
      innerOpen?: boolean;
    }) {
      return (
        <ModalWrapper isOpen onClose={onOuterClose} ariaLabel="Outer">
          <button>Outer action</button>
          <ModalWrapper isOpen={innerOpen} onClose={onInnerClose} ariaLabel="Inner">
            <button>Inner first</button>
            <button>Inner last</button>
          </ModalWrapper>
        </ModalWrapper>
      );
    }

    it('Escape closes only the top-most modal', async () => {
      const onOuterClose = vi.fn();
      const onInnerClose = vi.fn();
      const user = userEvent.setup();
      render(<Nested onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);

      await user.keyboard('{Escape}');

      expect(onInnerClose).toHaveBeenCalledTimes(1);
      expect(onOuterClose).not.toHaveBeenCalled();
    });

    it('traps Tab inside the top-most modal only', async () => {
      const user = userEvent.setup();
      render(<Nested onOuterClose={vi.fn()} onInnerClose={vi.fn()} />);

      expect(screen.getByText('Inner first')).toHaveFocus();
      await user.tab();
      expect(screen.getByText('Inner last')).toHaveFocus();
      await user.tab();
      expect(screen.getByText('Inner first')).toHaveFocus();
    });

    it('returns focus to the parent modal when the inner trigger has unmounted', () => {
      const { rerender } = render(
        <Nested onOuterClose={vi.fn()} onInnerClose={vi.fn()} innerOpen />,
      );
      rerender(<Nested onOuterClose={vi.fn()} onInnerClose={vi.fn()} innerOpen={false} />);

      expect(screen.getByText('Outer action')).toHaveFocus();
    });
  });
});
