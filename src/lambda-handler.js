/**
 * Punto de entrada AWS Lambda (Function URL / API Gateway HTTP).
 */

const configure = require('@codegenie/serverless-express');
const { connectDb } = require('./infrastructure/mongo');
const { createApp } = require('./httpApp');

let cachedHandler;

async function getHandler() {
  if (!cachedHandler) {
    await connectDb();
    cachedHandler = configure({ app: createApp() });
  }
  return cachedHandler;
}

exports.handler = async (event, context) => {
  const handler = await getHandler();
  return handler(event, context);
};
