import React from 'react';
import { render, screen } from '@testing-library/react';
import { CommodityTicker, CommodityPrice } from '../components/CommodityTicker';

describe('CommodityTicker Component', () => {
  const mockPrices: CommodityPrice[] = [
    {
      symbol: 'MAIZE',
      name: 'White Maize (MT)',
      priceUsdc: 182.5,
      change24h: 2.35,
      lastUpdated: '2026-08-24T00:00:00Z',
    },
    {
      symbol: 'COFFEE',
      name: 'Coffee Arabica (kg)',
      priceUsdc: 345.8,
      change24h: -1.12,
      lastUpdated: '2026-08-24T00:00:00Z',
    },
  ];

  it('renders commodity names and formatted prices', () => {
    render(<CommodityTicker initialPrices={mockPrices} />);
    expect(screen.getByText('White Maize (MT)')).toBeInTheDocument();
    expect(screen.getByText('$182.50')).toBeInTheDocument();
    expect(screen.getByText('+2.35%')).toBeInTheDocument();
    expect(screen.getByText('Coffee Arabica (kg)')).toBeInTheDocument();
    expect(screen.getByText('-1.12%')).toBeInTheDocument();
  });
});
