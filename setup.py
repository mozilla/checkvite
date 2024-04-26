from setuptools import setup, find_packages

setup(
    name="checkvite",
    version="0.1",
    packages=find_packages(),
    entry_points={
        "console_scripts": [
            "checkvite-web=checkvite.serve:main",
        ],
    },
)
