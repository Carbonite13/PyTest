import logging
import sys

__all__ = ["module_log"]

def module_log(name, level = logging.INFO):
    """To be called at the top of a module to get the corresponding logger"""
    logger = logging.getLogger(name)
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        formatter = logging.Formatter(
            "[%(asctime)s %(levelname)s %(name)s %(lineno)d] %(message)s"
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    return logger