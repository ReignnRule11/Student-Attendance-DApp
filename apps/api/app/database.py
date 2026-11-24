import asyncio
import asyncpg

from app.settings import settings


async def check_database() -> bool:
    try:
        connection = await asyncio.wait_for(asyncpg.connect(settings.database_url), timeout=3.0)
        try:
            await connection.fetchval("SELECT 1")
            return True
        finally:
            await connection.close()
    except (asyncpg.PostgresError, OSError, asyncio.TimeoutError, ValueError):
        return False
