import uvicorn as corn

from Pot.config import settings
from Pot.main import create_app
from Pot.main import main

if __name__ == "__main__":
    # start the uvicorn server
    main()
