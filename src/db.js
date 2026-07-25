import { openDB } from "idb";

const DB_NAME = "shipping-picking-system-db";
const DB_VERSION = 1;
const STORE_NAME = "app-data";
const SHIPPING_DATA_KEY = "shipping-data";

async function getDatabase() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    },
  });
}

export async function loadShippingData() {
  const database = await getDatabase();
  const savedData = await database.get(
    STORE_NAME,
    SHIPPING_DATA_KEY
  );

  return Array.isArray(savedData) ? savedData : [];
}

export async function saveShippingData(shippingData) {
  const database = await getDatabase();

  await database.put(
    STORE_NAME,
    shippingData,
    SHIPPING_DATA_KEY
  );
}

export async function clearShippingData() {
  const database = await getDatabase();

  await database.delete(
    STORE_NAME,
    SHIPPING_DATA_KEY
  );
}