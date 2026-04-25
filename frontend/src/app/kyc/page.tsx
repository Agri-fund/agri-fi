'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';

type Mode = 'individual' | 'business';

export default function KycPage() {
  const router = useRouter();
  const currentUser = useMemo(() => apiClient.getCurrentUser(), []);

  const [mode, setMode] = useState<Mode>('individual');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [governmentIdUrl, setGovernmentIdUrl] = useState('');
  const [proofOfAddressUrl, setProofOfAddressUrl] = useState('');

  const [companyName, setCompanyName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [businessLicenseUrl, setBusinessLicenseUrl] = useState('');
  const [articlesOfIncorporationUrl, setArticlesOfIncorporationUrl] =
    useState('');

  useEffect(() => {
    if (!currentUser) router.push('/login');
  }, [currentUser, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const payload =
        mode === 'business'
          ? {
              isCorporate: true,
              companyName: companyName || undefined,
              registrationNumber: registrationNumber || undefined,
              businessLicenseUrl: businessLicenseUrl || undefined,
              articlesOfIncorporationUrl: articlesOfIncorporationUrl || undefined,
            }
          : {
              isCorporate: false,
              governmentIdUrl: governmentIdUrl || undefined,
              proofOfAddressUrl: proofOfAddressUrl || undefined,
            };

      const res = await apiClient.submitKyc(payload);
      setSuccess(`KYC submitted. Status: ${res.kycStatus}`);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'KYC failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">KYC Verification</h1>
          <p className="mt-2 text-sm text-gray-600">
            Verify as an individual or a business entity
          </p>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={submit}>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <div className="text-sm text-red-600">{error}</div>
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4">
                <div className="text-sm text-green-700">{success}</div>
              </div>
            )}

            <div>
              <span className="block text-sm font-medium text-gray-700">
                Verification Type
              </span>
              <div className="mt-2 flex gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="mode"
                    value="individual"
                    checked={mode === 'individual'}
                    onChange={() => setMode('individual')}
                  />
                  Individual
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="mode"
                    value="business"
                    checked={mode === 'business'}
                    onChange={() => setMode('business')}
                  />
                  Business
                </label>
              </div>
            </div>

            {mode === 'individual' ? (
              <>
                <div>
                  <label
                    htmlFor="governmentIdUrl"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Government ID URL
                  </label>
                  <div className="mt-1">
                    <input
                      id="governmentIdUrl"
                      type="url"
                      value={governmentIdUrl}
                      onChange={(e) => setGovernmentIdUrl(e.target.value)}
                      placeholder="https://..."
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="proofOfAddressUrl"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Proof of Address URL
                  </label>
                  <div className="mt-1">
                    <input
                      id="proofOfAddressUrl"
                      type="url"
                      value={proofOfAddressUrl}
                      onChange={(e) => setProofOfAddressUrl(e.target.value)}
                      placeholder="https://..."
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="companyName"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Company Name
                  </label>
                  <div className="mt-1">
                    <input
                      id="companyName"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="registrationNumber"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Business Registration Number
                  </label>
                  <div className="mt-1">
                    <input
                      id="registrationNumber"
                      value={registrationNumber}
                      onChange={(e) => setRegistrationNumber(e.target.value)}
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="articlesOfIncorporationUrl"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Articles of Incorporation URL
                  </label>
                  <div className="mt-1">
                    <input
                      id="articlesOfIncorporationUrl"
                      type="url"
                      value={articlesOfIncorporationUrl}
                      onChange={(e) =>
                        setArticlesOfIncorporationUrl(e.target.value)
                      }
                      placeholder="https://..."
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="businessLicenseUrl"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Business License URL (optional)
                  </label>
                  <div className="mt-1">
                    <input
                      id="businessLicenseUrl"
                      type="url"
                      value={businessLicenseUrl}
                      onChange={(e) => setBusinessLicenseUrl(e.target.value)}
                      placeholder="https://..."
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Submitting...' : 'Submit KYC'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

