import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrencyInput } from '../ui/CurrencyInput';

describe('CurrencyInput', () => {
  it('formats USD values with commas and two decimals on blur', async () => {
    const user = userEvent.setup();
    let value = '1234.5';
    const handleChange = jest.fn((nextValue: string) => {
      value = nextValue;
      rerenderInput();
    });

    const rerenderInput = () =>
      view.rerender(
        <CurrencyInput
          aria-label="USD amount"
          currency="usd"
          prefix="$"
          value={value}
          onChange={handleChange}
        />,
      );

    const view = render(
      <CurrencyInput
        aria-label="USD amount"
        currency="usd"
        prefix="$"
        value={value}
        onChange={handleChange}
      />,
    );

    const input = screen.getByLabelText('USD amount');
    expect(input).toHaveValue('1,234.5');

    await user.click(input);
    await user.tab();

    expect(handleChange).toHaveBeenLastCalledWith('1234.50');
    expect(screen.getByLabelText('USD amount')).toHaveValue('1,234.50');
  });

  it('restricts USD input to positive decimals with two places', async () => {
    const user = userEvent.setup();
    let value = '';
    const handleChange = jest.fn((nextValue: string) => {
      value = nextValue;
      rerenderInput();
    });

    const rerenderInput = () =>
      view.rerender(
        <CurrencyInput
          aria-label="USD amount"
          currency="usd"
          value={value}
          onChange={handleChange}
        />,
      );

    const view = render(
      <CurrencyInput
        aria-label="USD amount"
        currency="usd"
        value={value}
        onChange={handleChange}
      />,
    );

    const input = screen.getByLabelText('USD amount');
    await user.type(input, 'abc1234.567');

    expect(handleChange).toHaveBeenLastCalledWith('1234.56');
    expect(screen.getByLabelText('USD amount')).toHaveValue('1,234.56');
  });

  it('supports Stellar precision with seven decimals and suffixes', async () => {
    const user = userEvent.setup();
    let value = '';
    const handleChange = jest.fn((nextValue: string) => {
      value = nextValue;
      rerenderInput();
    });

    const rerenderInput = () =>
      view.rerender(
        <CurrencyInput
          aria-label="XLM amount"
          currency="stellar"
          suffix="XLM"
          value={value}
          onChange={handleChange}
        />,
      );

    const view = render(
      <CurrencyInput
        aria-label="XLM amount"
        currency="stellar"
        suffix="XLM"
        value={value}
        onChange={handleChange}
      />,
    );

    const input = screen.getByLabelText('XLM amount');
    await user.type(input, '10.123456789');
    await user.tab();

    expect(handleChange).toHaveBeenLastCalledWith('10.1234567');
    expect(screen.getByLabelText('XLM amount')).toHaveValue('10.1234567');
    expect(screen.getByText('XLM')).toBeInTheDocument();
  });
});
