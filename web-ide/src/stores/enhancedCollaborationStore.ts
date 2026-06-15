/**
 * Advanced Collaboration Features
 * Voice chat, screen sharing, and video conferencing using WebRTC
 */

export interface VoiceChatConfig {
  enabled: boolean;
  muted: boolean;
  deafened: boolean;
  volume: number;
}

export interface ScreenShareConfig {
  enabled: boolean;
  stream?: MediaStream;
  participants: string[];
}

export interface VideoCallConfig {
  enabled: boolean;
  participants: Array<{
    id: string;
    name: string;
    stream?: MediaStream;
    muted: boolean;
    videoEnabled: boolean;
  }>;
}

export class CollaborationEnhancements {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private voiceConfig: VoiceChatConfig = {
    enabled: false,
    muted: false,
    deafened: false,
    volume: 1.0,
  };
  private screenConfig: ScreenShareConfig = {
    enabled: false,
    participants: [],
  };
  private videoConfig: VideoCallConfig = {
    enabled: false,
    participants: [],
  };

  /**
   * Initialize voice chat
   */
  async initializeVoiceChat(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      
      this.localStream = stream;
      this.voiceConfig.enabled = true;
    } catch (error) {
      console.error('Failed to initialize voice chat:', error);
      throw new Error('Microphone access denied');
    }
  }

  /**
   * Toggle microphone mute
   */
  toggleMute(): void {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        this.voiceConfig.muted = !audioTrack.enabled;
      }
    }
  }

  /**
   * Toggle deafen (mute incoming audio)
   */
  toggleDeafen(): void {
    this.voiceConfig.deafened = !this.voiceConfig.deafened;
  }

  /**
   * Set volume
   */
  setVolume(volume: number): void {
    this.voiceConfig.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Start screen sharing
   */
  async startScreenSharing(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
        },
        audio: false,
      });

      this.screenStream = stream;
      this.screenConfig.enabled = true;

      // Handle user stopping screen share
      stream.getVideoTracks()[0].onended = () => {
        this.stopScreenSharing();
      };
    } catch (error) {
      console.error('Failed to start screen sharing:', error);
      throw new Error('Screen sharing denied');
    }
  }

  /**
   * Stop screen sharing
   */
  stopScreenSharing(): void {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    this.screenConfig.enabled = false;
    this.screenConfig.participants = [];
  }

  /**
   * Start video call
   */
  async startVideoCall(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      this.localStream = stream;
      this.videoConfig.enabled = true;
    } catch (error) {
      console.error('Failed to start video call:', error);
      throw new Error('Camera/microphone access denied');
    }
  }

  /**
   * Stop video call
   */
  stopVideoCall(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    this.videoConfig.enabled = false;
    this.videoConfig.participants = [];
  }

  /**
   * Toggle camera in video call
   */
  toggleCamera(): void {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
      }
    }
  }

  /**
   * Add participant to call
   */
  addParticipant(participant: {
    id: string;
    name: string;
    stream?: MediaStream;
  }): void {
    const existing = this.videoConfig.participants.find(p => p.id === participant.id);
    if (!existing) {
      this.videoConfig.participants.push({
        ...participant,
        muted: false,
        videoEnabled: !!participant.stream,
      });
    }
  }

  /**
   * Remove participant from call
   */
  removeParticipant(participantId: string): void {
    this.videoConfig.participants = this.videoConfig.participants.filter(
      p => p.id !== participantId
    );
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      voice: this.voiceConfig,
      screen: this.screenConfig,
      video: this.videoConfig,
    };
  }

  /**
   * Cleanup all resources
   */
  cleanup(): void {
    this.stopScreenSharing();
    this.stopVideoCall();
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}

/**
 * Enhanced Collaboration Store for React
 */
import { create } from 'zustand';

interface EnhancedCollaborationState {
  voiceEnabled: boolean;
  screenShareEnabled: boolean;
  videoCallEnabled: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  volume: number;
  participants: Array<{
    id: string;
    name: string;
    isSpeaking: boolean;
  }>;
  error: string | null;
  
  // Actions
  initializeVoice: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setVolume: (volume: number) => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  startVideoCall: () => Promise<void>;
  stopVideoCall: () => void;
  toggleCamera: () => void;
  setError: (error: string | null) => void;
}

let collaborationEnhancements: CollaborationEnhancements | null = null;

export const useEnhancedCollaborationStore = create<EnhancedCollaborationState>((set) => ({
  voiceEnabled: false,
  screenShareEnabled: false,
  videoCallEnabled: false,
  isMuted: false,
  isDeafened: false,
  volume: 1.0,
  participants: [],
  error: null,

  setError: (error) => set({ error }),

  initializeVoice: async () => {
    if (!collaborationEnhancements) {
      collaborationEnhancements = new CollaborationEnhancements();
    }

    try {
      await collaborationEnhancements.initializeVoiceChat();
      const config = collaborationEnhancements.getConfig();
      set({
        voiceEnabled: config.voice.enabled,
        isMuted: config.voice.muted,
        isDeafened: config.voice.deafened,
        volume: config.voice.volume,
      });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to initialize voice',
      });
    }
  },

  toggleMute: () => {
    collaborationEnhancements?.toggleMute();
    const config = collaborationEnhancements?.getConfig();
    set({
      isMuted: config?.voice.muted || false,
    });
  },

  toggleDeafen: () => {
    collaborationEnhancements?.toggleDeafen();
    const config = collaborationEnhancements?.getConfig();
    set({
      isDeafened: config?.voice.deafened || false,
    });
  },

  setVolume: (volume) => {
    collaborationEnhancements?.setVolume(volume);
    set({ volume });
  },

  startScreenShare: async () => {
    if (!collaborationEnhancements) {
      collaborationEnhancements = new CollaborationEnhancements();
    }

    try {
      await collaborationEnhancements.startScreenSharing();
      const config = collaborationEnhancements.getConfig();
      set({
        screenShareEnabled: config.screen.enabled,
      });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to start screen share',
      });
    }
  },

  stopScreenShare: () => {
    collaborationEnhancements?.stopScreenSharing();
    set({ screenShareEnabled: false });
  },

  startVideoCall: async () => {
    if (!collaborationEnhancements) {
      collaborationEnhancements = new CollaborationEnhancements();
    }

    try {
      await collaborationEnhancements.startVideoCall();
      const config = collaborationEnhancements.getConfig();
      set({
        videoCallEnabled: config.video.enabled,
      });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to start video call',
      });
    }
  },

  stopVideoCall: () => {
    collaborationEnhancements?.stopVideoCall();
    set({ 
      videoCallEnabled: false,
      participants: [],
    });
  },

  toggleCamera: () => {
    collaborationEnhancements?.toggleCamera();
  },
}));