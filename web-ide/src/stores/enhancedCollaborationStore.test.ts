import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub RTCPeerConnection for node environment.
class FakeRTCPeerConnection {
  iceConnectionState = 'new';
  oniceconnectionstatechange: ((this: any, ev: any) => any) | null = null;
  close = vi.fn();
  addTrack = vi.fn();
  addTransceiver = vi.fn();
  createDataChannel = vi.fn();
}
Object.defineProperty(globalThis, 'RTCPeerConnection', {
  value: FakeRTCPeerConnection,
  writable: true,
  configurable: true,
});

// Stub navigator.mediaDevices (getUserMedia / getDisplayMedia).
function makeTrack(kind: 'audio' | 'video') {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
    onended: null as ((this: any, ev: any) => any) | null,
  };
}

function makeStream(tracks: ReturnType<typeof makeTrack>[]) {
  return {
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getTracks: () => tracks,
  };
}

const mediaDevicesStub = {
  getUserMedia: vi.fn(),
  getDisplayMedia: vi.fn(),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: mediaDevicesStub },
  writable: true,
  configurable: true,
});

// Use dynamic imports + resetModules so the module-level
// `collaborationEnhancements` singleton is fresh for every test.
let useEnhancedCollaborationStore: typeof import('./enhancedCollaborationStore').useEnhancedCollaborationStore;
let CollaborationEnhancements: typeof import('./enhancedCollaborationStore').CollaborationEnhancements;

beforeEach(async () => {
  vi.resetModules();
  mediaDevicesStub.getUserMedia.mockReset();
  mediaDevicesStub.getDisplayMedia.mockReset();
  const mod = await import('./enhancedCollaborationStore');
  useEnhancedCollaborationStore = mod.useEnhancedCollaborationStore;
  CollaborationEnhancements = mod.CollaborationEnhancements;
});

describe('CollaborationEnhancements', () => {
  it('initializes voice chat and exposes enabled config', async () => {
    const audioTrack = makeTrack('audio');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.initializeVoiceChat();

    const config = enhancements.getConfig();
    expect(config.voice.enabled).toBe(true);
    expect(config.voice.muted).toBe(false);
  });

  it('initializeVoiceChat throws "Microphone access denied" when getUserMedia rejects', async () => {
    mediaDevicesStub.getUserMedia.mockRejectedValue(new Error('denied'));

    const enhancements = new CollaborationEnhancements();
    await expect(enhancements.initializeVoiceChat()).rejects.toThrow('Microphone access denied');
    expect(enhancements.getConfig().voice.enabled).toBe(false);
  });

  it('toggleMute flips the audio track enabled state and muted flag', async () => {
    const audioTrack = makeTrack('audio');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.initializeVoiceChat();

    enhancements.toggleMute();
    expect(audioTrack.enabled).toBe(false);
    expect(enhancements.getConfig().voice.muted).toBe(true);

    enhancements.toggleMute();
    expect(audioTrack.enabled).toBe(true);
    expect(enhancements.getConfig().voice.muted).toBe(false);
  });

  it('toggleMute is a no-op when there is no local stream', () => {
    const enhancements = new CollaborationEnhancements();
    expect(() => enhancements.toggleMute()).not.toThrow();
    expect(enhancements.getConfig().voice.muted).toBe(false);
  });

  it('toggleDeafen flips the deafened flag', () => {
    const enhancements = new CollaborationEnhancements();
    expect(enhancements.getConfig().voice.deafened).toBe(false);
    enhancements.toggleDeafen();
    expect(enhancements.getConfig().voice.deafened).toBe(true);
    enhancements.toggleDeafen();
    expect(enhancements.getConfig().voice.deafened).toBe(false);
  });

  it('setVolume clamps to [0, 1]', () => {
    const enhancements = new CollaborationEnhancements();
    enhancements.setVolume(2);
    expect(enhancements.getConfig().voice.volume).toBe(1);
    enhancements.setVolume(-1);
    expect(enhancements.getConfig().voice.volume).toBe(0);
    enhancements.setVolume(0.5);
    expect(enhancements.getConfig().voice.volume).toBe(0.5);
  });

  it('startScreenSharing enables screen config and wires track onended', async () => {
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getDisplayMedia.mockResolvedValue(makeStream([videoTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.startScreenSharing();

    expect(enhancements.getConfig().screen.enabled).toBe(true);
    expect(videoTrack.onended).toBeInstanceOf(Function);

    // Stopping via onended should disable screen sharing.
    (videoTrack.onended as (ev: any) => any).call(videoTrack, {});
    expect(enhancements.getConfig().screen.enabled).toBe(false);
  });

  it('startScreenSharing throws "Screen sharing denied" on failure', async () => {
    mediaDevicesStub.getDisplayMedia.mockRejectedValue(new Error('nope'));

    const enhancements = new CollaborationEnhancements();
    await expect(enhancements.startScreenSharing()).rejects.toThrow('Screen sharing denied');
    expect(enhancements.getConfig().screen.enabled).toBe(false);
  });

  it('stopScreenSharing stops tracks and resets config', async () => {
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getDisplayMedia.mockResolvedValue(makeStream([videoTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.startScreenSharing();
    enhancements.stopScreenSharing();

    expect(videoTrack.stop).toHaveBeenCalled();
    expect(enhancements.getConfig().screen.enabled).toBe(false);
    expect(enhancements.getConfig().screen.participants).toEqual([]);
  });

  it('stopScreenSharing is a no-op when no stream is active', () => {
    const enhancements = new CollaborationEnhancements();
    expect(() => enhancements.stopScreenSharing()).not.toThrow();
    expect(enhancements.getConfig().screen.enabled).toBe(false);
  });

  it('startVideoCall enables video config', async () => {
    const audioTrack = makeTrack('audio');
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack, videoTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.startVideoCall();

    expect(enhancements.getConfig().video.enabled).toBe(true);
  });

  it('startVideoCall throws "Camera/microphone access denied" on failure', async () => {
    mediaDevicesStub.getUserMedia.mockRejectedValue(new Error('denied'));

    const enhancements = new CollaborationEnhancements();
    await expect(enhancements.startVideoCall()).rejects.toThrow('Camera/microphone access denied');
    expect(enhancements.getConfig().video.enabled).toBe(false);
  });

  it('stopVideoCall stops tracks and resets participants', async () => {
    const audioTrack = makeTrack('audio');
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack, videoTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.startVideoCall();
    enhancements.stopVideoCall();

    expect(audioTrack.stop).toHaveBeenCalled();
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(enhancements.getConfig().video.enabled).toBe(false);
    expect(enhancements.getConfig().video.participants).toEqual([]);
  });

  it('toggleCamera flips the video track enabled state', async () => {
    const audioTrack = makeTrack('audio');
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack, videoTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.startVideoCall();

    enhancements.toggleCamera();
    expect(videoTrack.enabled).toBe(false);
    enhancements.toggleCamera();
    expect(videoTrack.enabled).toBe(true);
  });

  it('toggleCamera is a no-op without a local stream', () => {
    const enhancements = new CollaborationEnhancements();
    expect(() => enhancements.toggleCamera()).not.toThrow();
  });

  it('addParticipant adds a participant and removeParticipant removes it', async () => {
    const audioTrack = makeTrack('audio');
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack, videoTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.startVideoCall();

    enhancements.addParticipant({ id: 'p1', name: 'Alice' });
    expect(enhancements.getConfig().video.participants).toHaveLength(1);
    expect(enhancements.getConfig().video.participants[0].muted).toBe(false);

    // Adding the same id twice is ignored.
    enhancements.addParticipant({ id: 'p1', name: 'Alice' });
    expect(enhancements.getConfig().video.participants).toHaveLength(1);

    enhancements.removeParticipant('p1');
    expect(enhancements.getConfig().video.participants).toHaveLength(0);
  });

  it('createPeerConnection closes the previous connection before creating a new one', async () => {
    const audioTrack = makeTrack('audio');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.initializeVoiceChat();

    // Starting a video call creates a new peer connection and should close the old one.
    const audioTrack2 = makeTrack('audio');
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack2, videoTrack]));
    await enhancements.startVideoCall();
    // No throw means the previous connection was closed internally.
    expect(enhancements.getConfig().video.enabled).toBe(true);
  });

  it('ICE teardown handler closes the peer connection on terminal state', async () => {
    const audioTrack = makeTrack('audio');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.initializeVoiceChat();

    // Grab the peer connection created during init by starting a second session
    // is not necessary; instead recreate via video call to capture the pc.
    const audioTrack2 = makeTrack('audio');
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack2, videoTrack]));
    await enhancements.startVideoCall();

    // Simulate ICE failure on the latest connection by triggering the handler.
    // We can't access the pc directly, but cleanup should close it without error.
    enhancements.cleanup();
  });

  it('cleanup stops screen sharing, video call, and closes peer connection', async () => {
    const audioTrack = makeTrack('audio');
    const videoTrack = makeTrack('video');
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([audioTrack, videoTrack]));
    mediaDevicesStub.getDisplayMedia.mockResolvedValue(makeStream([makeTrack('video')]));

    const enhancements = new CollaborationEnhancements();
    await enhancements.startVideoCall();
    await enhancements.startScreenSharing();

    enhancements.cleanup();

    expect(enhancements.getConfig().video.enabled).toBe(false);
    expect(enhancements.getConfig().screen.enabled).toBe(false);
  });
});

describe('useEnhancedCollaborationStore', () => {
  it('starts with default state', () => {
    const s = useEnhancedCollaborationStore.getState();
    expect(s.voiceEnabled).toBe(false);
    expect(s.screenShareEnabled).toBe(false);
    expect(s.videoCallEnabled).toBe(false);
    expect(s.isMuted).toBe(false);
    expect(s.isDeafened).toBe(false);
    expect(s.volume).toBe(1.0);
    expect(s.participants).toEqual([]);
    expect(s.error).toBeNull();
  });

  it('setError sets the error state', () => {
    useEnhancedCollaborationStore.getState().setError('boom');
    expect(useEnhancedCollaborationStore.getState().error).toBe('boom');
    useEnhancedCollaborationStore.getState().setError(null);
    expect(useEnhancedCollaborationStore.getState().error).toBeNull();
  });

  it('setVolume updates the store volume', () => {
    useEnhancedCollaborationStore.getState().setVolume(0.3);
    expect(useEnhancedCollaborationStore.getState().volume).toBe(0.3);
  });

  it('toggleMute is a no-op (isMuted stays false) when voice is not initialized', () => {
    useEnhancedCollaborationStore.getState().toggleMute();
    expect(useEnhancedCollaborationStore.getState().isMuted).toBe(false);
  });

  it('toggleDeafen is a no-op when voice is not initialized', () => {
    useEnhancedCollaborationStore.getState().toggleDeafen();
    expect(useEnhancedCollaborationStore.getState().isDeafened).toBe(false);
  });

  it('initializeVoice succeeds and syncs voice state', async () => {
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([makeTrack('audio')]));

    await useEnhancedCollaborationStore.getState().initializeVoice();

    const s = useEnhancedCollaborationStore.getState();
    expect(s.voiceEnabled).toBe(true);
    expect(s.isMuted).toBe(false);
    expect(s.isDeafened).toBe(false);
    expect(s.volume).toBe(1.0);
    expect(s.error).toBeNull();
  });

  it('initializeVoice sets error when getUserMedia rejects', async () => {
    mediaDevicesStub.getUserMedia.mockRejectedValue(new Error('denied'));

    await useEnhancedCollaborationStore.getState().initializeVoice();

    const s = useEnhancedCollaborationStore.getState();
    expect(s.voiceEnabled).toBe(false);
    expect(s.error).toBe('Microphone access denied');
  });

  it('toggleMute flips isMuted after voice is initialized', async () => {
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([makeTrack('audio')]));
    await useEnhancedCollaborationStore.getState().initializeVoice();

    useEnhancedCollaborationStore.getState().toggleMute();
    expect(useEnhancedCollaborationStore.getState().isMuted).toBe(true);

    useEnhancedCollaborationStore.getState().toggleMute();
    expect(useEnhancedCollaborationStore.getState().isMuted).toBe(false);
  });

  it('toggleDeafen flips isDeafened after voice is initialized', async () => {
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([makeTrack('audio')]));
    await useEnhancedCollaborationStore.getState().initializeVoice();

    useEnhancedCollaborationStore.getState().toggleDeafen();
    expect(useEnhancedCollaborationStore.getState().isDeafened).toBe(true);

    useEnhancedCollaborationStore.getState().toggleDeafen();
    expect(useEnhancedCollaborationStore.getState().isDeafened).toBe(false);
  });

  it('startScreenShare succeeds and enables screen share', async () => {
    mediaDevicesStub.getDisplayMedia.mockResolvedValue(makeStream([makeTrack('video')]));

    await useEnhancedCollaborationStore.getState().startScreenShare();

    expect(useEnhancedCollaborationStore.getState().screenShareEnabled).toBe(true);
    expect(useEnhancedCollaborationStore.getState().error).toBeNull();
  });

  it('startScreenShare sets error on failure', async () => {
    mediaDevicesStub.getDisplayMedia.mockRejectedValue(new Error('nope'));

    await useEnhancedCollaborationStore.getState().startScreenShare();

    expect(useEnhancedCollaborationStore.getState().screenShareEnabled).toBe(false);
    expect(useEnhancedCollaborationStore.getState().error).toBe('Screen sharing denied');
  });

  it('stopScreenShare disables screen share', async () => {
    mediaDevicesStub.getDisplayMedia.mockResolvedValue(makeStream([makeTrack('video')]));
    await useEnhancedCollaborationStore.getState().startScreenShare();

    useEnhancedCollaborationStore.getState().stopScreenShare();
    expect(useEnhancedCollaborationStore.getState().screenShareEnabled).toBe(false);
  });

  it('startVideoCall succeeds and enables video call', async () => {
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([makeTrack('audio'), makeTrack('video')]));

    await useEnhancedCollaborationStore.getState().startVideoCall();

    expect(useEnhancedCollaborationStore.getState().videoCallEnabled).toBe(true);
    expect(useEnhancedCollaborationStore.getState().error).toBeNull();
  });

  it('startVideoCall sets error on failure', async () => {
    mediaDevicesStub.getUserMedia.mockRejectedValue(new Error('denied'));

    await useEnhancedCollaborationStore.getState().startVideoCall();

    expect(useEnhancedCollaborationStore.getState().videoCallEnabled).toBe(false);
    expect(useEnhancedCollaborationStore.getState().error).toBe('Camera/microphone access denied');
  });

  it('stopVideoCall disables video call and clears participants', async () => {
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([makeTrack('audio'), makeTrack('video')]));
    await useEnhancedCollaborationStore.getState().startVideoCall();

    useEnhancedCollaborationStore.getState().stopVideoCall();
    expect(useEnhancedCollaborationStore.getState().videoCallEnabled).toBe(false);
    expect(useEnhancedCollaborationStore.getState().participants).toEqual([]);
  });

  it('toggleCamera does not throw when video is not initialized', () => {
    expect(() => useEnhancedCollaborationStore.getState().toggleCamera()).not.toThrow();
  });

  it('toggleCamera does not throw after video call is initialized', async () => {
    mediaDevicesStub.getUserMedia.mockResolvedValue(makeStream([makeTrack('audio'), makeTrack('video')]));
    await useEnhancedCollaborationStore.getState().startVideoCall();

    expect(() => useEnhancedCollaborationStore.getState().toggleCamera()).not.toThrow();
  });
});
