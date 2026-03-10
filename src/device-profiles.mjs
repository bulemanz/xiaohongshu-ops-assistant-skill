export const deviceProfiles = {
  "redmi-k80": {
    screen: {
      width: 1080,
      height: 2400
    },
    home: {
      publishTab: { x: 540, y: 2260 },
      messageTab: { x: 756, y: 2290 }
    },
    messages: {
      commentsCard: { x: 870, y: 390 }
    },
    editor: {
      titleField: { x: 561, y: 607 },
      bodyField: { x: 540, y: 981 },
      publishButton: { x: 704, y: 2222 },
      saveDraftButton: { x: 192, y: 2222 },
      backButton: { x: 76, y: 191 }
    },
    imageEdit: {
      nextButton: { x: 944, y: 2296 }
    }
  }
};

export function getDeviceProfile(name) {
  const profile = deviceProfiles[name];
  if (!profile) {
    throw new Error(`Unknown device profile: ${name}`);
  }
  return profile;
}
