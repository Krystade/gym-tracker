// The app's owner (social S2): who grants the ✓ (config/verified) and, later, moderates the board. A list, so a second moderator is
// one more uid here and in firestore.rules OWNERS(), which is what actually holds the line: this only decides what the app shows.
// A test keeps the two lists the same. A uid is not a secret: it's in every friend's list and every message's path.

export const OWNERS: readonly string[] = ['FKCm35XFmSZyVtn3XdtO9TBJmOw2'];

export const isOwner = (uid: string | null | undefined) => !!uid && OWNERS.includes(uid);
