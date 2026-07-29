'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ProfileData {
  name: string;
  email: string;
  phone: string;
  country: string;
  region: string;
}

interface FarmData {
  farmName: string;
  farmSize: number;
  farmSizeUnit: string;
  location: string;
  primaryCrops: string;
  farmingType: string;
}

interface WalletData {
  walletAddress: string;
  walletProvider: string;
}

const STEPS = [
  { id: 'profile', title: 'Profile', description: 'Personal information' },
  { id: 'farm', title: 'Farm Details', description: 'Farm location and crops' },
  { id: 'wallet', title: 'Wallet Setup', description: 'Connect your wallet' },
];

export default function FarmerOnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const [profileData, setProfileData] = useState<ProfileData>({
    name: '',
    email: '',
    phone: '',
    country: '',
    region: '',
  });

  const [farmData, setFarmData] = useState<FarmData>({
    farmName: '',
    farmSize: 0,
    farmSizeUnit: 'hectares',
    location: '',
    primaryCrops: '',
    farmingType: '',
  });

  const [walletData, setWalletData] = useState<WalletData>({
    walletAddress: '',
    walletProvider: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 0) {
      if (!profileData.name.trim()) newErrors.name = 'Name is required';
      if (!profileData.email.trim()) newErrors.email = 'Email is required';
      if (!profileData.phone.trim()) newErrors.phone = 'Phone is required';
      if (!profileData.country.trim()) newErrors.country = 'Country is required';
    }

    if (step === 1) {
      if (!farmData.farmName.trim()) newErrors.farmName = 'Farm name is required';
      if (!farmData.farmSize || farmData.farmSize <= 0) newErrors.farmSize = 'Farm size is required';
      if (!farmData.location.trim()) newErrors.location = 'Location is required';
      if (!farmData.primaryCrops.trim()) newErrors.primaryCrops = 'Primary crops are required';
    }

    if (step === 2) {
      if (!walletData.walletAddress.trim()) newErrors.walletAddress = 'Wallet address is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSaveAndExit = async () => {
    setLoading(true);
    try {
      // Save progress to localStorage or API
      const onboardingData = {
        step: currentStep,
        profileData,
        farmData,
        walletData,
      };
      localStorage.setItem('farmer_onboarding_progress', JSON.stringify(onboardingData));
      setSaved(true);
      setTimeout(() => {
        router.push('/dashboard');
      }, 1000);
    } catch (error) {
      console.error('Failed to save progress:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return;
    setLoading(true);
    try {
      // Submit complete onboarding data to API
      const completeData = {
        profileData,
        farmData,
        walletData,
      };
      // await apiClient.submitFarmerOnboarding(completeData);
      localStorage.removeItem('farmer_onboarding_progress');
      router.push('/dashboard');
    } catch (error) {
      console.error('Failed to submit onboarding:', error);
    } finally {
      setLoading(false);
    }
  };

  const progressPercentage = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar */}
      <nav className="glass sticky top-0 z-20 border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 font-black text-slate-900">
            <span className="text-xl">🌾</span> AgriFi
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAndExit}
              disabled={loading}
              className="btn-secondary text-sm px-4 py-2"
            >
              {loading ? 'Saving…' : saved ? 'Saved!' : 'Save & Exit'}
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Farmer Onboarding
            </h1>
            <span className="text-sm font-semibold text-slate-600">
              {progressPercentage.toFixed(0)}% Complete
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div
              className="bg-brand-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <div className="flex justify-between mt-3">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    index <= currentStep
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-200 text-slate-400'
                  }`}
                >
                  {index < currentStep ? '✓' : index + 1}
                </div>
                <span
                  className={`text-xs mt-1 font-medium ${
                    index === currentStep
                      ? 'text-brand-600'
                      : index < currentStep
                      ? 'text-slate-600'
                      : 'text-slate-400'
                  }`}
                >
                  {step.title}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="card p-8">
          {/* Step 0: Profile */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">Profile Information</h2>
                <p className="text-slate-500 text-sm">Tell us about yourself</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Full Name</label>
                  <input
                    className="input"
                    type="text"
                    value={profileData.name}
                    onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                    placeholder="Amara Diallo"
                  />
                  {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
                </div>

                <div>
                  <label className="label">Email Address</label>
                  <input
                    className="input"
                    type="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                    placeholder="you@example.com"
                  />
                  {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
                </div>

                <div>
                  <label className="label">Phone Number</label>
                  <input
                    className="input"
                    type="tel"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    placeholder="+234 800 000 0000"
                  />
                  {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone}</p>}
                </div>

                <div>
                  <label className="label">Country</label>
                  <input
                    className="input"
                    type="text"
                    value={profileData.country}
                    onChange={(e) => setProfileData({ ...profileData, country: e.target.value })}
                    placeholder="Nigeria"
                  />
                  {errors.country && <p className="text-xs text-red-600 mt-1">{errors.country}</p>}
                </div>

                <div className="md:col-span-2">
                  <label className="label">Region/State</label>
                  <input
                    className="input"
                    type="text"
                    value={profileData.region}
                    onChange={(e) => setProfileData({ ...profileData, region: e.target.value })}
                    placeholder="Lagos"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Farm Details */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">Farm Details</h2>
                <p className="text-slate-500 text-sm">Tell us about your farm</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="label">Farm Name</label>
                  <input
                    className="input"
                    type="text"
                    value={farmData.farmName}
                    onChange={(e) => setFarmData({ ...farmData, farmName: e.target.value })}
                    placeholder="Green Valley Farms"
                  />
                  {errors.farmName && <p className="text-xs text-red-600 mt-1">{errors.farmName}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Farm Size</label>
                    <input
                      className="input"
                      type="number"
                      value={farmData.farmSize}
                      onChange={(e) => setFarmData({ ...farmData, farmSize: Number(e.target.value) })}
                      placeholder="10"
                    />
                    {errors.farmSize && <p className="text-xs text-red-600 mt-1">{errors.farmSize}</p>}
                  </div>

                  <div>
                    <label className="label">Unit</label>
                    <select
                      className="input"
                      value={farmData.farmSizeUnit}
                      onChange={(e) => setFarmData({ ...farmData, farmSizeUnit: e.target.value })}
                    >
                      <option value="hectares">Hectares</option>
                      <option value="acres">Acres</option>
                      <option value="sqm">Square Meters</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">Farm Location</label>
                  <input
                    className="input"
                    type="text"
                    value={farmData.location}
                    onChange={(e) => setFarmData({ ...farmData, location: e.target.value })}
                    placeholder="Ikorodu, Lagos State"
                  />
                  {errors.location && <p className="text-xs text-red-600 mt-1">{errors.location}</p>}
                </div>

                <div>
                  <label className="label">Primary Crops</label>
                  <input
                    className="input"
                    type="text"
                    value={farmData.primaryCrops}
                    onChange={(e) => setFarmData({ ...farmData, primaryCrops: e.target.value })}
                    placeholder="Maize, Cassava, Rice"
                  />
                  {errors.primaryCrops && (
                    <p className="text-xs text-red-600 mt-1">{errors.primaryCrops}</p>
                  )}
                </div>

                <div>
                  <label className="label">Farming Type</label>
                  <select
                    className="input"
                    value={farmData.farmingType}
                    onChange={(e) => setFarmData({ ...farmData, farmingType: e.target.value })}
                  >
                    <option value="">Select farming type</option>
                    <option value="subsistence">Subsistence</option>
                    <option value="commercial">Commercial</option>
                    <option value="mixed">Mixed Farming</option>
                    <option value="organic">Organic</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Wallet Setup */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">Wallet Setup</h2>
                <p className="text-slate-500 text-sm">Connect your Stellar wallet</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="label">Wallet Address</label>
                  <input
                    className="input"
                    type="text"
                    value={walletData.walletAddress}
                    onChange={(e) => setWalletData({ ...walletData, walletAddress: e.target.value })}
                    placeholder="G..."
                  />
                  {errors.walletAddress && (
                    <p className="text-xs text-red-600 mt-1">{errors.walletAddress}</p>
                  )}
                </div>

                <div>
                  <label className="label">Wallet Provider</label>
                  <select
                    className="input"
                    value={walletData.walletProvider}
                    onChange={(e) => setWalletData({ ...walletData, walletProvider: e.target.value })}
                  >
                    <option value="">Select wallet provider</option>
                    <option value="freighter">Freighter</option>
                    <option value="albedo">Albedo</option>
                    <option value="lobstr">LOBSTR</option>
                  </select>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-sm text-blue-800">
                    <strong>Why connect a wallet?</strong> Your wallet is used to receive payments and
                    manage your agricultural assets on the Stellar blockchain.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
            <button
              onClick={handleBack}
              disabled={currentStep === 0}
              className="btn-secondary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← Back
            </button>

            {currentStep === STEPS.length - 1 ? (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Submitting…' : 'Complete Onboarding →'}
              </button>
            ) : (
              <button
                onClick={handleNext}
                className="btn-primary px-6 py-2.5"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
