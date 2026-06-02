import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Companion = {
  name: string;
  gender: 'male' | 'female' | 'nonbinary';
  description: string;
  appearance: string;
  voiceStyle: string;
  language: 'hinglish' | 'english' | 'hindi';
  tone: number;
  creativity: number;
};

export type UserProfile = {
  name: string;
  tags: string[];
  level: number;
  xp: number;
  streak: number;
  sessions: number;
};

export type AppTheme = 'forest' | 'midnight' | 'ocean' | 'sakura' | 'amber';

export type Settings = {
  theme: AppTheme;
  notifications: boolean;
  dailyReminder: string;
  weeklyReport: boolean;
  dataSharing: boolean;
  analytics: boolean;
  sessionRecording: boolean;
  fontSize: 'small' | 'medium' | 'large';
  language: string;
};

export type SharedMessage = {
  id: number;
  role: 'student' | 'psych';
  text: string;
  time: string;
};

export type PsychBooking = {
  slot: string;
  sessionType: 'video' | 'audio' | 'chat';
  notes: string;
};

type StoreState = {
  user: UserProfile | null;
  companion: Companion | null;
  completedQuests: number[];
  settings: Settings;
  psychNotes: Record<number, string>;
  // Shared psych <-> student messaging (keyed by psychologist id)
  psychMessages: Record<number, SharedMessage[]>;
  // Last-read message id per psychId, used for psych unread badge
  psychLastRead: Record<number, number>;
  // Bookings keyed by psychologist id
  psychBookings: Record<number, PsychBooking>;

  setUser: (u: UserProfile) => void;
  setCompanion: (c: Companion) => void;
  completeQuest: (id: number, xp: number) => void;
  updateSettings: (s: Partial<Settings>) => void;
  setPsychNote: (patientId: number, note: string) => void;
  addPsychMessage: (psychId: number, msg: SharedMessage) => void;
  markPsychRead: (psychId: number) => void;
  setPsychBooking: (psychId: number, booking: PsychBooking) => void;
  removePsychBooking: (psychId: number) => void;
};

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      user: null,
      companion: null,
      completedQuests: [],
      settings: {
        theme: 'forest',
        notifications: true,
        dailyReminder: '09:00',
        weeklyReport: true,
        dataSharing: false,
        analytics: true,
        sessionRecording: false,
        fontSize: 'medium',
        language: 'hinglish',
      },
      psychNotes: {},
      psychMessages: {},
      psychLastRead: {},
      psychBookings: {},

      setUser: (u) => set({ user: u }),
      setCompanion: (c) => set({ companion: c }),
      completeQuest: (id, xp) =>
        set((state) => ({
          completedQuests: state.completedQuests.includes(id)
            ? state.completedQuests
            : [...state.completedQuests, id],
          user: state.user ? { ...state.user, xp: state.user.xp + xp } : null,
        })),
      updateSettings: (s) =>
        set((state) => ({ settings: { ...state.settings, ...s } })),
      setPsychNote: (patientId, note) =>
        set((state) => ({
          psychNotes: { ...state.psychNotes, [patientId]: note },
        })),
      addPsychMessage: (psychId, msg) =>
        set((state) => ({
          psychMessages: {
            ...state.psychMessages,
            [psychId]: [...(state.psychMessages[psychId] || []), msg],
          },
        })),
      markPsychRead: (psychId) =>
        set((state) => {
          const msgs = state.psychMessages[psychId] || [];
          const lastId = msgs.length > 0 ? msgs[msgs.length - 1].id : 0;
          return { psychLastRead: { ...state.psychLastRead, [psychId]: lastId } };
        }),
      setPsychBooking: (psychId, booking) =>
        set((state) => ({
          psychBookings: { ...state.psychBookings, [psychId]: booking },
        })),
      removePsychBooking: (psychId) =>
        set((state) => {
          const next = { ...state.psychBookings };
          delete next[psychId];
          return { psychBookings: next };
        }),
    }),
    { name: 'soulsync_v1' }
  )
);
