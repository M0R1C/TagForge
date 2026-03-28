![TagForge Logo](static/logo.png)

![GitHub stars](https://img.shields.io/github/stars/M0R1C/TagForge?style=for-the-badge)
![GitHub forks](https://img.shields.io/github/forks/M0R1C/TagForge?style=for-the-badge)
![GitHub issues](https://img.shields.io/github/issues/M0R1C/TagForge?style=for-the-badge)
![License](https://img.shields.io/github/license/M0R1C/TagForge?style=for-the-badge)
![Python](https://img.shields.io/badge/python-3.x-blue?style=for-the-badge)

**TagForge** - a flexible tool designed to help you quickly and conveniently store, edit, version, and analyze your datasets.  
The key priorities are simplicity, ease of use, well‑organized workspaces, and speed

# Features

* **Dataset Manager:** Create structured datasets split into versions, assign custom flags to versions for easy identification, manage version contents (rename, delete, smart fast import from folders, create subfolders inside versions for further segmentation), quickly export datasets to your working environment, easily spin up new versions based on existing ones. No need to manually handle file pairs - the tool automatically associates images with their captions and performs actions (e.g., renaming or deletion) on both when needed
* **Bulk Editing:** Edit caption content across all files at once (delete, add, replace), create backups, rename all files with sequential numbering for easier reference, automatically populate captions with tags using AI models. You can easily add your own ONNX models - just place them in the `models` folder and the program will pick them up automatically. Models from **Smiling Wolf** are recommended. You can also adjust confidence thresholds and operation modes
* **Point Editing:** Navigate your dataset conveniently using filters (age rating, duplicates, image resolution, aspect ratio, x32/x64, presence of specific tags in captions). Get a quick overview of each image through badges showing age rating, resolution, aspect ratio, multiplicity, image quality (with detailed criteria breakdown), and duplicate indicators. Use auto‑complete hints for tags (similar to an IDE) to speed up manual tagging. Build structured tag dictionaries for your datasets and easily add or remove predefined tags from captions - extremely useful when preparing data, for example, for character LoRa models. Examine images in detail with a built‑in magnifier
* **Analytics:** Use a flexible dashboard with widgets to get visual insights into your dataset contents, assess quality, and compare versions through graphs
* **Settings:** Choose your preferred interface language (Russian and English are currently supported), customize the UI to your liking, set a convenient working directory (where your datasets are stored; relative, absolute, and remote paths are supported). Configure the tool’s network accessibility (IP address and port) to access it from any device in your home - for instance, work comfortably from a tablet instead of being tied to your computer
* **Additional:** You can also work with third‑party datasets directly without importing them into the working directory if that’s more convenient - simply specify the absolute path to the dataset in the program header

# Installation and Launch

### **Windows:**

* Make sure you have Python 3.8.x or higher installed on your system
* Run `setup.bat`. It will automatically create a virtual environment, install dependencies, and generate a `run.bat` file for launching the program
* Run `run.bat` and enjoy

### **Linux:**

Automated installation via a script is not provided, so you’ll need to do it manually:

* Create a virtual environment (`venv`) inside the program folder
* Replace the line `onnxruntime-directml>=1.15.0` with `onnxruntime` in `requirements.txt`
* Install the dependencies from the updated file into your virtual environment

This will allow you to install and run the program on Linux systems, but automatic tagging and age rating evaluation will be slower because GPU acceleration won’t be available

# Support and Feedback

I’d be really grateful for your support, stars on the repository, feedback, and any kind of appreciation.

If you find a bug, have ideas for new features, or would like to help with translations or localization updates, feel free to reach out to me on Telegram - [**@Sansenskiy**](https://t.me/Sansenskiy)

# Acknowledgments

[SmilingWolf](https://huggingface.co/SmilingWolf) - for the pre‑trained models used in this tool.
