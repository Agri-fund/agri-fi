import type { Metadata } from 'next';
import './globals.css';
import { WalletButton } from '../components/WalletButton';

export const metadata: Metadata = {
  title: 'Agric-onchain Finance',
  description: 'Blockchain-backed agricultural trade finance platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="bg-white shadow-sm border-b">
          <div className="container mx-auto px-4">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center">
                <h1 className="text-xl font-bold text-green-800">
                  Agric-onchain Finance
                </h1>
              </div>
              <div className="flex items-center space-x-4">
                <WalletButton />
              </div>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
