import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CreateDealForm } from '../deals/CreateDealForm';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = jest.fn();

describe('CreateDealForm Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows error when total_value is 1000 or less', async () => {
    render(<CreateDealForm />);
    
    const totalValueInput = screen.getByLabelText(/Total Value/i);
    const submitButton = screen.getByRole('button', { name: /Create Deal/i });

    fireEvent.change(totalValueInput, { target: { value: '1000' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/Total value must be greater than 1000/i)).toBeInTheDocument();
  });

  it('shows error when token_price is not 100', async () => {
    render(<CreateDealForm />);
    
    const tokenPriceInput = screen.getByLabelText(/Token Price/i);
    const submitButton = screen.getByRole('button', { name: /Create Deal/i });

    fireEvent.change(tokenPriceInput, { target: { value: '101' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/Token price must be exactly 100/i)).toBeInTheDocument();
  });

  it('shows error when delivery_date is in the past', async () => {
    render(<CreateDealForm />);
    
    const deliveryDateInput = screen.getByLabelText(/Delivery Date/i);
    const submitButton = screen.getByRole('button', { name: /Create Deal/i });

    // Set to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateString = yesterday.toISOString().split('T')[0];

    fireEvent.change(deliveryDateInput, { target: { value: dateString } });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/End date must be in the future/i)).toBeInTheDocument();
  });

  it('shows error when commodity is empty', async () => {
    render(<CreateDealForm />);
    
    const submitButton = screen.getByRole('button', { name: /Create Deal/i });

    fireEvent.click(submitButton);

    expect(await screen.findByText(/Commodity name is required/i)).toBeInTheDocument();
  });

  it('submits successfully with valid data', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: '123' }),
    });

    render(<CreateDealForm />);
    
    fireEvent.change(screen.getByLabelText(/Commodity Name/i), { target: { value: 'Cocoa' } });
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Total Value/i), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText(/Token Price/i), { target: { value: '100' } });
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateString = tomorrow.toISOString().split('T')[0];
    fireEvent.change(screen.getByLabelText(/Delivery Date/i), { target: { value: dateString } });

    fireEvent.click(screen.getByRole('button', { name: /Create Deal/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/trade-deals', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"commodity":"Cocoa"'),
      }));
    });
  });
});
