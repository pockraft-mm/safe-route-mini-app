export type TripStatus = 'ACTIVE' | 'EMERGENCY' | 'COMPLETED';

export type User = {
  id: string;
  telegramId: string;
  displayName: string;
};

export type LocationPoint = {
  userId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  updatedAt: string;
};

export type Trip = {
  id: string;
  inviteCode: string;
  status: TripStatus;
  deadlineAt: string;
  createdAt: string;
  ownerId: string;
  startLatitude?: number | null;
  startLongitude?: number | null;
  destination?: string | null;
  members: Array<{ userId: string; displayName: string; joinedAt: string }>;
  locations: LocationPoint[];
};

export type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string }> };

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string; username?: string } };
        ready: () => void;
        expand: () => void;
        openTelegramLink: (url: string) => void;
        HapticFeedback?: { notificationOccurred: (type: 'error' | 'success' | 'warning') => void };
      };
    };
  }
}
