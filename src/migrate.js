const { migrate, close } = require('./db');

migrate()
  .then(() => {
    console.log('Database migrated successfully');
    return close();
  })
  .catch(async (error) => {
    console.error(error);
    await close();
    process.exit(1);
  });
