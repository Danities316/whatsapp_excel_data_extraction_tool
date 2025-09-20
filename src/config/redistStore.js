class RedisStore {
  constructor(redisClient) {
    this.redisClient = redisClient;
  }

async sessionExists({ session  }) {
  console.log(`Checking session existence for: ${session }`); // This will log the session  correctly
  if (!session ) {
    console.error('sessionExists called with undefined session ');
    return false;
  }
  try {
    const exists = await this.redisClient.exists(`wa_session:${session }`);
    console.log(`Session ${session } exists: ${exists === 1}`);
    return exists === 1;
  } catch (error) {
    console.error(`Failed to check if session ${session } exists:`, error);
    return false;
  }
}


  async save({ session , data }) {
    console.log(`[RedisStore] Called save for: ${session}`);
    if (!session  || !data) {
      console.error(`Cannot save session: session =${session }, data=${JSON.stringify(data)}`);
      return;
    }
    try {
      console.log(`Saving session ${session } with data:`, data);
      await this.redisClient.set(`wa_session:${session }`, JSON.stringify(data), { EX: 86400 });
      console.log(`Successfully saved session ${session }`);
    } catch (error) {
      console.error(`Failed to save session ${session }:`, error);
    }
  }

  async extract({ session  }) {
    console.log(`[RedisStore] Called extract for: ${session}`);
    if (!session ) {
      console.error(`Cannot extract session: session =${session }`);
      return null;
    }
    try {
      const data = await this.redisClient.get(`wa_session:${session }`);
      if (!data) {
        console.log(`No session data found for ${session }`);
        return null;
      }
      console.log(`Extracted session ${session }:`, data);
      return JSON.parse(data);
    } catch (error) {
      console.error(`Failed to extract session ${session }:`, error);
      return null;
    }
  }

  async remove({ sessionId }) {
    console.log(`[RedisStore] Called remove for: ${sessionId}`);
    if (!sessionId) {
      console.error(`Cannot remove session: sessionId=${sessionId}`);
      return;
    }
    try {
      await this.redisClient.del(`wa_session:${sessionId}`);
      console.log(`Removed session ${sessionId}`);
    } catch (error) {
      console.error(`Failed to remove session ${sessionId}:`, error);
    }
  }
}

export default RedisStore;