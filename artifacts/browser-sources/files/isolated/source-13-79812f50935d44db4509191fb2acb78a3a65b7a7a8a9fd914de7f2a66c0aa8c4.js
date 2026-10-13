

	let positionWarning = () => {
		let passwarn = document.getElementById("passwarn");
		let bonkiocontainer = document.getElementById("bonkiocontainer");
		let pagecontainer = document.getElementById("pagecontainer");

		let offset = ((pagecontainer.offsetHeight - bonkiocontainer.offsetHeight) / 4) - passwarn.offsetHeight/2; 
		passwarn.style.bottom = offset+"px";
		passwarn.style.display = "block";
	}

	window.addEventListener('resize', () => {
		positionWarning();
	});

	let observer = new ResizeObserver(() => {
		positionWarning();
	});

	observer.observe(bonkiocontainer);

