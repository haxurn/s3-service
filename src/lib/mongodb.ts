import { MongoClient } from "mongodb";

let mongoClient: MongoClient | null = null;
let isConnected = false;

export const getMongoClient = async (): Promise<MongoClient> => {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.DATABASE_URL!);
  }

  if (!isConnected) {
    await mongoClient.connect();
    isConnected = true;
    
    // Handle connection close
    mongoClient.on('close', () => {
      isConnected = false;
    });
  }

  return mongoClient;
};

export const closeMongoConnection = async (): Promise<void> => {
  if (mongoClient && isConnected) {
    await mongoClient.close();
    isConnected = false;
  }
};