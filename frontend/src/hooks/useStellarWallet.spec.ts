import { renderHook, waitFor } from "@testing-library/react";
import { useStellarWallet } from "./useStellarWallet";
import * as useWalletModule from "./useWallet";

// Mock the useWallet hook
jest.mock("./useWallet");

const mockUseWallet = useWalletModule.useWallet as jest.Mock;

// Mock window.open for Freighter installation redirect
global.window.open = jest.fn();

describe("useStellarWallet", () => {
  const mockPublicKey =
    "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQR";

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variable
    delete (process.env as any).NEXT_PUBLIC_STELLAR_NETWORK;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Initial State", () => {
    it("returns disconnected state when wallet is not connected", () => {
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.status).toBe("disconnected");
      expect(result.current.publicKey).toBeNull();
      expect(result.current.displayKey).toBeNull();
      expect(result.current.isFreighterInstalled).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("returns connecting state while loading", () => {
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: true,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.status).toBe("connecting");
    });

    it("returns connected state with public key when wallet is connected", () => {
      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.status).toBe("connected");
      expect(result.current.publicKey).toBe(mockPublicKey);
      expect(result.current.isFreighterInstalled).toBe(true);
    });
  });

  describe("Public Key Display Truncation", () => {
    it("truncates public key to display format (first 6 + last 4 characters)", () => {
      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.displayKey).toBe("GABCDE…OPQR");
    });

    it("returns null displayKey when publicKey is null", () => {
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.displayKey).toBeNull();
    });

    it("correctly truncates various public key lengths", () => {
      const testCases = [
        {
          key: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQR",
          expected: "GABCDE…OPQR",
        },
        {
          key: "GABCDEFGHIJ",
          expected: "GABCDE…GHIJ",
        },
        {
          key: "GABCDEFGHIJKLMN",
          expected: "GABCDE…KLMN",
        },
      ];

      testCases.forEach(({ key, expected }) => {
        mockUseWallet.mockReturnValue({
          isConnected: true,
          isLoading: false,
          publicKey: key,
          availableWallets: ["freighter"],
          error: null,
          connect: jest.fn(),
          disconnect: jest.fn(),
          signTransaction: jest.fn(),
        });

        const { result } = renderHook(() => useStellarWallet());
        expect(result.current.displayKey).toBe(expected);
      });
    });
  });

  describe("Network Detection", () => {
    it("returns Testnet when NEXT_PUBLIC_STELLAR_NETWORK is not set", () => {
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.network).toBe("Testnet");
    });

    it("returns Testnet when NEXT_PUBLIC_STELLAR_NETWORK is not mainnet", () => {
      (process.env as any).NEXT_PUBLIC_STELLAR_NETWORK = "testnet";

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.network).toBe("Testnet");
    });

    it("returns Public when NEXT_PUBLIC_STELLAR_NETWORK is mainnet", () => {
      (process.env as any).NEXT_PUBLIC_STELLAR_NETWORK = "mainnet";

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.network).toBe("Public");
    });
  });

  describe("Freighter Detection", () => {
    it("detects when Freighter is installed", () => {
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.isFreighterInstalled).toBe(true);
    });

    it("detects when Freighter is not installed", () => {
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.isFreighterInstalled).toBe(false);
    });

    it("detects when Freighter is available among other wallets", () => {
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["albedo", "freighter", "ledger"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.isFreighterInstalled).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("returns error message when connection fails", () => {
      const errorMessage = "User denied connection";
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: errorMessage,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.error).toBe(errorMessage);
      expect(result.current.status).toBe("disconnected");
    });

    it("returns null error when no error occurs", () => {
      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.error).toBeNull();
    });
  });

  describe("Connection Handling", () => {
    it("calls connect with freighter when Freighter is installed", async () => {
      const mockConnect = jest.fn().mockResolvedValue(mockPublicKey);

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      await result.current.connect();

      expect(mockConnect).toHaveBeenCalledWith("freighter");
    });

    it("opens Freighter download page when Freighter is not installed", async () => {
      const mockConnect = jest.fn();

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: mockConnect,
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      await result.current.connect();

      expect(window.open).toHaveBeenCalledWith(
        "https://freighter.app/",
        "_blank",
        "noopener,noreferrer",
      );
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it("does not throw when window.open is called", async () => {
      const mockConnect = jest.fn();

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: [],
        error: null,
        connect: mockConnect,
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      // Should not throw
      await expect(result.current.connect()).resolves.toBeUndefined();
    });
  });

  describe("Disconnection Handling", () => {
    it("calls disconnect when disconnect is invoked", () => {
      const mockDisconnect = jest.fn();

      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      result.current.disconnect();

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it("properly disconnects when connected", () => {
      const mockDisconnect = jest.fn();
      const mockConnect = jest.fn();

      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(result.current.status).toBe("connected");

      result.current.disconnect();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("State Transitions", () => {
    it("transitions from disconnected to connecting to connected", () => {
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result, rerender } = renderHook(() => useStellarWallet());

      expect(result.current.status).toBe("disconnected");

      // Simulate connecting state
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: true,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      rerender();

      expect(result.current.status).toBe("connecting");

      // Simulate connected state
      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      rerender();

      expect(result.current.status).toBe("connected");
      expect(result.current.publicKey).toBe(mockPublicKey);
    });

    it("transitions from connected to disconnected", () => {
      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result, rerender } = renderHook(() => useStellarWallet());

      expect(result.current.status).toBe("connected");
      expect(result.current.publicKey).toBe(mockPublicKey);

      // Simulate disconnection
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      rerender();

      expect(result.current.status).toBe("disconnected");
      expect(result.current.publicKey).toBeNull();
      expect(result.current.displayKey).toBeNull();
    });

    it("handles error state during connection attempt", () => {
      const errorMessage = "Connection timeout";

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: errorMessage,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result, rerender } = renderHook(() => useStellarWallet());

      expect(result.current.status).toBe("disconnected");
      expect(result.current.error).toBe(errorMessage);

      // Clear error on reconnect attempt
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: true,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      rerender();

      expect(result.current.error).toBeNull();
      expect(result.current.status).toBe("connecting");
    });
  });

  describe("Freighter API Response Mocking", () => {
    it("exposes wallet functions properly", () => {
      const mockConnect = jest.fn().mockResolvedValue(mockPublicKey);
      const mockDisconnect = jest.fn();

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      expect(typeof result.current.connect).toBe("function");
      expect(typeof result.current.disconnect).toBe("function");
    });

    it("handles async connect operation", async () => {
      const mockConnect = jest.fn().mockResolvedValue(mockPublicKey);

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      await expect(result.current.connect()).resolves.toBeUndefined();
      expect(mockConnect).toHaveBeenCalledWith("freighter");
    });

    it("handles connect rejection", async () => {
      const mockConnect = jest
        .fn()
        .mockRejectedValue(new Error("User rejected"));

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: jest.fn(),
        signTransaction: jest.fn(),
      });

      const { result } = renderHook(() => useStellarWallet());

      await expect(result.current.connect()).rejects.toThrow("User rejected");
    });
  });

  describe("Complete Integration Scenarios", () => {
    it("simulates complete wallet connection flow", async () => {
      const mockConnect = jest.fn().mockResolvedValue(mockPublicKey);
      const mockDisconnect = jest.fn();

      // Step 1: Initial disconnected state
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      const { result, rerender } = renderHook(() => useStellarWallet());
      expect(result.current.status).toBe("disconnected");

      // Step 2: Connecting
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: true,
        publicKey: null,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      rerender();
      expect(result.current.status).toBe("connecting");

      // Step 3: Connected
      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      rerender();
      expect(result.current.status).toBe("connected");
      expect(result.current.publicKey).toBe(mockPublicKey);
      expect(result.current.displayKey).toBe("GABCDE…OPQR");

      // Step 4: Disconnect
      await result.current.connect();
      result.current.disconnect();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it("simulates wallet disconnection event handling", () => {
      const mockDisconnect = jest.fn();

      // Start connected
      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: jest.fn(),
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      const { result, rerender } = renderHook(() => useStellarWallet());
      expect(result.current.status).toBe("connected");

      // Simulate wallet disconnection event
      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: "Wallet disconnected by user",
        connect: jest.fn(),
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      rerender();
      expect(result.current.status).toBe("disconnected");
      expect(result.current.publicKey).toBeNull();
      expect(result.current.error).toBe("Wallet disconnected by user");
    });

    it("handles multiple connection attempts with different outcomes", async () => {
      const mockConnect = jest.fn();
      const mockDisconnect = jest.fn();

      // First attempt fails
      mockConnect.mockRejectedValueOnce(new Error("Connection failed"));

      mockUseWallet.mockReturnValue({
        isConnected: false,
        isLoading: false,
        publicKey: null,
        availableWallets: ["freighter"],
        error: "Connection failed",
        connect: mockConnect,
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      const { result, rerender } = renderHook(() => useStellarWallet());
      expect(result.current.error).toBe("Connection failed");

      // Second attempt succeeds
      mockConnect.mockResolvedValueOnce(mockPublicKey);

      mockUseWallet.mockReturnValue({
        isConnected: true,
        isLoading: false,
        publicKey: mockPublicKey,
        availableWallets: ["freighter"],
        error: null,
        connect: mockConnect,
        disconnect: mockDisconnect,
        signTransaction: jest.fn(),
      });

      rerender();
      expect(result.current.status).toBe("connected");
      expect(result.current.error).toBeNull();
    });
  });
});
