import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaxSettings } from '../TaxSettings';
import * as taxApi from '@/lib/api/tax-report';

jest.mock('@/lib/api/tax-report');

const mockGetTaxSettings = taxApi.getTaxSettings as jest.Mock;
const mockSaveTaxSettings = taxApi.saveTaxSettings as jest.Mock;

describe('TaxSettings Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTaxSettings.mockResolvedValue({
      jurisdiction: 'US',
      tin: '***-**-6789',
      preferredFormat: 'csv',
    });
  });

  describe('Loading and Display', () => {
    it('should display loading state initially', () => {
      render(<TaxSettings />);
      expect(screen.getByText('Loading tax settings...')).toBeInTheDocument();
    });

    it('should load and display settings', async () => {
      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('US')).toBeInTheDocument();
      });
    });

    it('should display jurisdiction label', async () => {
      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText('Tax Jurisdiction')).toBeInTheDocument();
      });
    });

    it('should display TIN field with label', async () => {
      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText(/SSN.*Social Security Number/)).toBeInTheDocument();
      });
    });
  });

  describe('TIN Input', () => {
    it('should show masked TIN from API', async () => {
      mockGetTaxSettings.mockResolvedValue({
        jurisdiction: 'US',
        tin: '***-**-6789',
        preferredFormat: 'csv',
      });

      render(<TaxSettings />);

      await waitFor(() => {
        const tinInput = screen.getByDisplayValue('***-**-6789');
        expect(tinInput).toHaveAttribute('type', 'password');
      });
    });

    it('should allow updating masked TIN', async () => {
      const user = userEvent.setup();

      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText('Update')).toBeInTheDocument();
      });

      const updateButton = screen.getByText('Update');
      await user.click(updateButton);

      // Input should now be editable
      const tinInput = screen.getByPlaceholderText('123-45-6789');
      expect(tinInput).not.toHaveAttribute('disabled');
    });

    it('should validate TIN format', async () => {
      const user = userEvent.setup();

      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText('Update')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Update'));
      const tinInput = screen.getByPlaceholderText('123-45-6789');
      await user.type(tinInput, 'invalid');

      const saveButton = screen.getByText('Save Settings');
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/format invalid/)).toBeInTheDocument();
      });
    });
  });

  describe('Jurisdiction Selection', () => {
    it('should display all jurisdiction options', async () => {
      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('US')).toBeInTheDocument();
      });

      const select = screen.getByDisplayValue('US');
      expect(select).toBeInTheDocument();
    });

    it('should clear TIN when changing jurisdiction', async () => {
      const user = userEvent.setup();

      mockGetTaxSettings.mockResolvedValue({
        jurisdiction: 'US',
        tin: '123-45-6789',
        preferredFormat: 'csv',
      });

      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('US')).toBeInTheDocument();
      });

      const jurisdictionSelect = screen.getByDisplayValue('US');
      await user.selectOption(jurisdictionSelect, 'UK');

      // TIN should be cleared
      const tinInput = screen.getByPlaceholderText('AB123456C');
      expect(tinInput).toHaveValue('');
    });
  });

  describe('Format Selection', () => {
    it('should display format options', async () => {
      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText('Preferred Tax Report Format')).toBeInTheDocument();
      });

      expect(screen.getByDisplayValue('csv')).toBeInTheDocument();
      expect(screen.getByDisplayValue('pdf')).toBeInTheDocument();
    });

    it('should select CSV by default', async () => {
      render(<TaxSettings />);

      await waitFor(() => {
        const csvRadio = screen.getByDisplayValue('csv') as HTMLInputElement;
        expect(csvRadio.checked).toBe(true);
      });
    });

    it('should allow changing format', async () => {
      const user = userEvent.setup();

      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('csv')).toBeInTheDocument();
      });

      const pdfRadio = screen.getByDisplayValue('pdf');
      await user.click(pdfRadio);

      expect(pdfRadio).toBeChecked();
    });
  });

  describe('Save Functionality', () => {
    it('should save valid settings', async () => {
      const user = userEvent.setup();

      mockSaveTaxSettings.mockResolvedValue(undefined);

      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText('Save Settings')).toBeInTheDocument();
      });

      const saveButton = screen.getByText('Save Settings');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockSaveTaxSettings).toHaveBeenCalled();
      });
    });

    it('should show success message on save', async () => {
      const user = userEvent.setup();

      mockSaveTaxSettings.mockResolvedValue(undefined);

      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText('Save Settings')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Save Settings'));

      await waitFor(() => {
        expect(screen.getByText('✓ Tax settings saved successfully')).toBeInTheDocument();
      });
    });

    it('should show error message on save failure', async () => {
      const user = userEvent.setup();

      mockSaveTaxSettings.mockRejectedValue(new Error('Save failed'));

      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText('Save Settings')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Save Settings'));

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });
    });
  });

  describe('Security & Privacy', () => {
    it('should display privacy notice', async () => {
      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText(/encrypted using industry-standard AES-256/)).toBeInTheDocument();
      });
    });

    it('should display that TIN is not shared', async () => {
      render(<TaxSettings />);

      await waitFor(() => {
        expect(screen.getByText(/never shared with third parties/)).toBeInTheDocument();
      });
    });
  });
});
