import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CreateDealForm } from '../deals/CreateDealForm';
import { ToastProvider } from '../ui/ToastProvider';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = jest.fn();

const renderForm = () =>
  render(
    <ToastProvider>
      <CreateDealForm />
    </ToastProvider>,
  );

describe('CreateDealForm Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows error when total_value is 1000 or less', async () => {
    renderForm();

    const totalValueInput = screen.getByLabelText(/totalValue/i);
    const submitButton = screen.getByRole('button', { name: /createButton/i });

    fireEvent.change(totalValueInput, { target: { value: '1000' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText('validation.totalValueMin')).toBeInTheDocument();
  });

  it('shows error when token_price is not 100', async () => {
    renderForm();

    const tokenPriceInput = screen.getByLabelText(/tokenPrice/i);
    const submitButton = screen.getByRole('button', { name: /createButton/i });

    fireEvent.change(tokenPriceInput, { target: { value: '101' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText('validation.tokenPriceFixed')).toBeInTheDocument();
  });

  it('shows error when delivery_date is in the past', async () => {
    renderForm();

    const deliveryDateInput = screen.getByLabelText(/deliveryDate/i);
    const submitButton = screen.getByRole('button', { name: /createButton/i });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split('T')[0];

    fireEvent.change(deliveryDateInput, { target: { value: dateString } });
    fireEvent.click(submitButton);

    expect(await screen.findByText('validation.deliveryDateFuture')).toBeInTheDocument();
  });

  it('shows error when commodity is empty', async () => {
    renderForm();

    const submitButton = screen.getByRole('button', { name: /createButton/i });
    fireEvent.click(submitButton);

    expect(await screen.findByText('validation.commodityRequired')).toBeInTheDocument();
  });

  it('submits successfully with valid data', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: '123' }),
    });

    renderForm();

    fireEvent.change(screen.getByLabelText(/commodity/i), { target: { value: 'Cocoa' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/totalValue/i), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText(/tokenPrice/i), { target: { value: '100' } });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateString = tomorrow.toISOString().split('T')[0];
    fireEvent.change(screen.getByLabelText(/deliveryDate/i), { target: { value: dateString } });

    fireEvent.click(screen.getByRole('button', { name: /createButton/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/trade-deals', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"commodity":"Cocoa"'),
      }));
    });
  });
});
